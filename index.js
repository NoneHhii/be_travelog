const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

process.env.PAYOS_CLIENT_ID = "50fc716b-e7bb-42d7-b248-37da9ae5f45e";
process.env.PAYOS_API_KEY = "ff473510-2825-44ee-b72f-dffbf22dbf99";
process.env.PAYOS_CHECKSUM_KEY = "773fb6325a84a89030af7eb7a75115842474a3244d30f23165b9ee5c8dfae029";

// --- BƯỚC 2: IMPORT VÀ KHỞI TẠO ---
const { PayOS } = require("@payos/node");

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // MUST be before routes

// --- CONFIGURE PAYOS ---
// Replace these strings with your actual keys from https://payos.vn/ (Sandbox)
const payOS = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);


// --- HELPER FUNCTION ---
function chunkArray(arr, size) {
    const chunks = [];
    for(let i = 0; i < arr.length; i+=size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// --- ROUTE: Get Coupons ---
app.post('/api/getCouponsByIds', async(req, res) => {
    const {ids} = req.body;
    if(!ids || ids.length === 0) {
        return res.status(400).json({error: 'Missing coupon IDs'});
    }

    const idChunks = chunkArray(ids, 30);
    const querryPromises = [];

    idChunks.forEach(chunk => {
        const q =  db.collection('coupons').where(admin.firestore.FieldPath.documentId(), 'in', chunk);
        querryPromises.push(q.get());
    });

    try {
        const allSnapShots = await Promise.all(querryPromises);
        let coupons = [];
        
        allSnapShots.forEach(snapshot => {
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                coupons.push({
                    id: doc.id,
                    ...data,
                    timeStart: data.timeStart ? data.timeStart.toDate() : null,
                    timeEnd: data.timeEnd ? data.timeEnd.toDate() : null,
                });
            });
        });
        console.log("Sending coupons:", coupons.length);
        res.json(coupons);
    } catch (error) {
        console.error("Error fetching coupons:", error);
        res.status(500).json({error: 'Failed to fetch coupons'});
    }
});

// --- ROUTE: Create Payment Link (PayOS) ---
app.post('/api/create-payment-link', async (req, res) => {
    try {
        const { amount, description, returnUrl, cancelUrl } = req.body;
        
        // Validate amount
        if (!amount || isNaN(amount)) {
             return res.status(400).json({ error: 1, message: "Invalid amount" });
        }

        // Generate a unique numeric Order Code
        const orderCode = Number(String(Date.now()).slice(-6));

        const body = {
            orderCode: orderCode,
            amount: Number(amount), // Ensure amount is a number
            description: description ? description.substring(0, 25) : "Thanh toan",
            items: [
                {
                    name: "Thanh toan Travelog",
                    quantity: 1,
                    price: Number(amount)
                }
            ],
            returnUrl: returnUrl,
            cancelUrl: cancelUrl
        };

        console.log("Creating PayOS link with body:", body); // Debug log

        const paymentLinkData = await payOS.paymentRequests.create(body);
        
        res.json({
            error: 0,
            message: "Success",
            data: paymentLinkData
        });

    } catch (error) {
        console.error("Error creating payment link:", error);
        res.status(500).json({ error: 1, message: error.message || "Fail to create payment link" });
    }
});

// --- ROUTE: Check Payment Status (PayOS) ---
app.post('/api/check-payment-status', async (req, res) => {
    try {
        const { orderCode } = req.body;
        
        if (!orderCode) {
            return res.status(400).json({ error: 1, message: "Missing orderCode" });
        }

        const paymentLinkInfo = await payOS.getPaymentLinkInformation(orderCode);
        
        res.json({
            error: 0,
            message: "Success",
            data: paymentLinkInfo // Contains status: "PAID", "PENDING", "CANCELLED"
        });
    } catch (error) {
        console.error("Error checking status:", error);
        res.status(500).json({ error: 1, message: "Fail to check status" });
    }
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});