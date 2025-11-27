const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const { PayOS } = require("@payos/node");

const app = express();

// --- 1. MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- 2. KHỞI TẠO FIREBASE ---
// Logic: Nếu có biến môi trường (trên Vercel) thì dùng biến đó.
// Nếu không (dưới Local), thử đọc file serviceAccountKey.json
try {
    let serviceAccount;
    
    // Kiểm tra xem đã khởi tạo app chưa để tránh lỗi "App already exists"
    if (!admin.apps.length) {
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            // Trường hợp chạy trên Vercel: Parse từ biến môi trường
            // Lưu ý: Biến này chứa toàn bộ nội dung JSON của file key
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } else {
            // Trường hợp chạy Local: Đọc file trực tiếp
            // Bạn cần đảm bảo file này tồn tại khi chạy lệnh 'node index.js'
            serviceAccount = require('./serviceAccountKey.json');
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase initialized successfully");
    }
} catch (error) {
    console.error("Lỗi khởi tạo Firebase:", error.message);
    console.error("Hãy đảm bảo bạn đã set biến môi trường FIREBASE_SERVICE_ACCOUNT trên Vercel hoặc có file serviceAccountKey.json ở local.");
}

const db = admin.firestore();

// --- 3. KHỞI TẠO PAYOS ---
// Lấy key từ Environment Variables (Cài đặt trong Vercel Dashboard)
const payOS = new PayOS(
    process.env.PAYOS_CLIENT_ID,
    process.env.PAYOS_API_KEY,
    process.env.PAYOS_CHECKSUM_KEY
);

// --- 4. HELPER FUNCTION ---
function chunkArray(arr, size) {
    const chunks = [];
    for(let i = 0; i < arr.length; i+=size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// --- 5. ROUTES ---

// Route kiểm tra server (Health Check)
app.get('/', (req, res) => {
    res.send("Travelog Backend is running on Vercel!");
});

// Route: Get Coupons
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

// Route: Create Payment Link (PayOS)
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

        console.log("Creating PayOS link with body:", body); 

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

// Route: Check Payment Status (PayOS)
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
            data: paymentLinkInfo 
        });
    } catch (error) {
        console.error("Error checking status:", error);
        res.status(500).json({ error: 1, message: "Fail to check status" });
    }
});

// --- 6. START SERVER ---
// Vercel cần export app, nhưng Local cần app.listen
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running locally at http://localhost:${PORT}`);
    });
}

// Bắt buộc phải có dòng này để Vercel biến Express thành Serverless Function
module.exports = app;