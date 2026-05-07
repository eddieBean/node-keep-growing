require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./db');
const e = require('express');
const fileUpload = require('express-fileupload');
const nodemailer = require('nodemailer');
const app = express();


// Sanitize text to prevent XSS attacks using REGEX!!!!
function escapeHtml(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// Sanitize item objects to prevent XSS when returning from API
function sanitizeItem(item) {
    if (!item) return item;
    return {
        ...item,
        name: escapeHtml(item.name),
        description: escapeHtml(item.description),
        condition: escapeHtml(item.condition),
        size: escapeHtml(item.size),
        isbn: escapeHtml(item.isbn)
    };
}

// Sanitize user objects to prevent XSS when returning from API
function sanitizeUser(user) {
    if (!user) return user;
    return {
        ...user,
        user_name: escapeHtml(user.user_name),
        email: escapeHtml(user.email),
        phone: escapeHtml(user.phone)
    };
}

app.use(cors());
app.use(express.urlencoded({ extended: true })); // parses HTML form submissions
app.use(express.json());                          // parses JSON requests
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));
app.use(fileUpload({
    safeFileNames: /[<>"'&]/g
}));

let emailer;
let testAccount;

async function initEmailer() {
    try {
        console.log('Attempting to create test email account...');
        testAccount = await nodemailer.createTestAccount();
        console.log('[EMAILER] Test account created:', testAccount.user);
        
        emailer = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false, //!!!!!????
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
        
        // Verify the connection
        await emailer.verify();
        console.log('[EMAILER] Email service initialized and verified');
        return true;
    } catch (err) {
        console.error('[EMAILER] Error initializing email service:', err.message);
        emailer = null;
        return false;
    }
}

// Wait for emailer to initialize, then start server
initEmailer().then(success => {
    if (!success) {
        console.warn('Warning: Email service failed to initialize, email features will not work');
    }
    setTimeout(() => {
        app.listen(3000, () => console.log('Server running on port 3000'));
    }, 500);
});

//serve data from pages specifically
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/images', express.static(path.join(__dirname, '..', 'frontend', 'images')));


app.post('/signup', async (req, res) => {

    const { email, password, phone } = req.body;
    console.log(req.body.email, req.body.password, req.body.phone);
    try {
        //test if the email or phone number has already been used
        const [existingEmail] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existingEmail.length > 0) {
            return res.status(400).json({ success: false, message: 'An account with that email already exists' })
        }
        const [existingPhone] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
        if (existingPhone.length > 0) {
            return res.status(400).json({ success: false, message: 'An account with that phone number already exists' })
        }
        //hash the password before storing it in the db
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        await db.query(
            'INSERT INTO users (email, password, phone) VALUES (?, ?, ?)',
            [email, hashedPassword, phone]
        );
        const userRows = await db.query('SELECT * FROM users WHERE email = ?', [email])
        req.session.user = userRows[0];
        res.json({ success: true, message: 'Signup successful' });

    } catch (err) {
        console.error('[SIGNUP] Signup error', err.message);
        res.status(500).json({ success: false, message: 'Signup failed' })
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log("request: " + req.body.email + req.body.password);
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No account with that email exists' })
        }

        const user = rows[0];
        console.log("db response: " + user.email + user.password);

        const match = await bcrypt.compare(password, user.password.toString());
        if (!match) {
            return res.status(400).json({ success: false, message: 'Incorrect Password' });
        }
        req.session.user = user;
        res.json({ success: true, message: 'Login successful' });

    } catch (err) {
        console.error('login error', err.message);
        res.status(500).json({ success: false, message: 'Login failed' })
    }
});


app.get('/logout', (req, res) => {
    console.log("logging out");
    req.session.destroy();
    res.redirect('/');
})

// API endpoint returning items as JSON
app.get('/api/items', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM items');
        const sanitizedItems = rows.map(sanitizeItem);
        res.json(sanitizedItems);
    } catch (err) {
        console.error('Database error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// API endpoint specific user's items as JSON
app.get('/api/user-items', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM items WHERE owner_id = ?', [req.session.user.user_id]);
        const sanitizedItems = rows.map(sanitizeItem);
        res.json(sanitizedItems);
    } catch (err) {
        console.error('Database error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Search Endpoint
app.get('/api/items/:search', async (req, res) => {
    const searchTerm = req.params.search;
    try {
        const [rows] = await db.query('SELECT * FROM items WHERE MATCH(name, description) AGAINST (?);', [searchTerm]);
        const sanitizedItems = rows.map(sanitizeItem);
        res.json(sanitizedItems);
    } catch (err) {
        console.error('Database error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Item page endpoint
app.get('/api/items/itemId/:itemId', async (req, res) => {
    const itemId = req.params.itemId;
    try{
        const [rows] = await db.query('SELECT * FROM items WHERE item_id = ?', [itemId]);
        const sanitizedItems = rows.map(sanitizeItem);
        res.json(sanitizedItems);
    } catch (err) {
        console.error('database error:' + err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Upload endpoint
app.post('/api/items/upload', async (req, res) => {

    console.log('[UPLOAD/IMAGE] Request received');
    if (!req.files || Object.keys(req.files).length === 0) {
        console.log('[UPLOAD/IMAGE] No files provided in request');
        return res.status(500).json({ success: false, message: 'No file uploaded' });
    }

    const uploadedImage = req.files.image;
    console.log(`[UPLOAD/IMAGE] File received: ${uploadedImage.name}, Size: ${uploadedImage.size} bytes`);

    const uploadPath = path.join(__dirname, '..', 'frontend', 'images', uploadedImage.name);
    console.log(`[UPLOAD/IMAGE] Target path: ${uploadPath}`);
    const image_url = uploadedImage.name;



    const {name, description, price, condition, size, ISBN, school, owner_id} = req.body;
    // Sanitize user input to prevent XSS
    const sanitizedName = escapeHtml(name);
    const sanitizedDescription = escapeHtml(description);
    const sanitizedCondition = escapeHtml(condition);
    const sanitizedSize = escapeHtml(size);
    const sanitizedISBN = escapeHtml(ISBN);
    const sanitizedSchool = escapeHtml(school);
    
    console.log('[UPLOAD/ITEM] Request received with data:', { name, description, price, condition, size, ISBN, image_url, owner_id });
    try {
        console.log('[UPLOAD/ITEM] Inserting item into database...');
        await db.query(
            'INSERT INTO items (`name`, `description`, `price`, `condition`, `size`, `isbn`, `image`, `owner_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [sanitizedName, sanitizedDescription, price, sanitizedCondition, sanitizedSize, sanitizedISBN, image_url, sanitizedSchool, owner_id]
        );
        console.log('[UPLOAD/ITEM] Success - Item inserted into database');
        try {
            await uploadedImage.mv(uploadPath);
            console.log(`[UPLOAD/IMAGE] Success - File saved to: ${uploadPath}, URL: ${image_url}`);
        } catch (err) {
            console.error(`[UPLOAD/IMAGE] Error moving file: ${err.message}`);
            await db.query('DELETE FROM items WHERE `name` = ? AND `description` = ? AND `price` = ? AND `condition` = ? AND `size` = ? AND `isbn` = ? AND `image` = ? AND `owner_id` = ?',
            [sanitizedName, sanitizedDescription, price, sanitizedCondition, sanitizedSize, sanitizedISBN, image_url, owner_id]);
            return res.status(500).json({ success: false, message: 'Image upload failed, item removed from database' });
        }
        res.json({ success: true, message: 'Item uploaded successfully' });
    } catch (err) {
        console.error('[UPLOAD/ITEM] Database error:', err.message);
        res.status(500).json({success: "false", error: 'Database error' });
    }

});

//emailing endpoint
app.post('/sendEmail', async (req, res) => {
    const { senderId, recipientId, itemId, content } = req.body;
    console.log("message request received with data: senderId:" + senderId + " recipientId: "+ recipientId + " itemId: "+ itemId + " content: "+ content);
    
    
    let recipient, sender, item;
    try {
        const [recipientRows] = await db.query('SELECT email FROM users WHERE user_id = ?', [recipientId]);
        const [senderRows] = await db.query('SELECT email, user_name, phone FROM users WHERE user_id = ?', [senderId]);
        const [itemRows] = await db.query('SELECT name FROM items WHERE item_id = ?', [itemId]);
        if (recipientRows.length === 0 || senderRows.length === 0 || itemRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid sender, recipient, or item ID' });
        }
        recipient = recipientRows[0];
        sender = senderRows[0];
        item = itemRows[0];
    }catch (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ success: false, message: '[SEND-EMAIL] Database error' });
    }
    
    if (!emailer) {
        return res.status(500).json({ success: false, message: '[EMAILER] Email service not ready' });
    }
    
    const mail = {
        from: testAccount.user,
        to: recipient.email,
        subject: `Message from user "${escapeHtml(sender.user_name)}" about your listing "${escapeHtml(item.name)}"`,
        text: `"${escapeHtml(sender.user_name)}"'s message:\n ${escapeHtml(content)} \n\nReply to ${escapeHtml(sender.user_name)} via text on ${escapeHtml(sender.phone)}`
    }
    console.log(JSON.stringify(mail));
    
    try {
        let result = await emailer.sendMail(mail);
        let testMessageUrl = nodemailer.getTestMessageUrl(result);
        db.query('UPDATE items SET sold = 1 WHERE item_id = ?', [itemId]);
        console.log("Email sent successfully, preview URL at: " + testMessageUrl);
        res.json({ success: true, message: 'Email sent successfully', previewUrl: testMessageUrl });
    } catch (err) {
        console.error('Error sending email:', err.message);
        res.status(500).json({ success: false, message: 'Failed to send email' });
    }
});

//session endpoint
app.get('/api/session', (req, res) => {
    if (req.session.user !== null && req.session.user !== undefined) {
        console.log(req.session.user.email +  "logged in");
        console.log(req.session.user.user_id + "logged in");
        const sanitizedUser = sanitizeUser(req.session.user);
        res.json({ loggedIn: true, user: sanitizedUser, user_id: req.session.user.user_id});
    } else {
        console.log("logged out");
        res.json({ loggedIn: false });
        
    }
});
