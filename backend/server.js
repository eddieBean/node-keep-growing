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

const emailer  = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
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
        req.session.userId = user.user_id;
        req.session.userEmail = email;
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
        res.json(rows);
    } catch (err) {
        console.error('Database error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/items/:search', async (req, res) => {
    const searchTerm = req.params.search;
    try {
        const [rows] = await db.query('SELECT * FROM items WHERE MATCH(name, description) AGAINST (?);', [searchTerm]);
        res.json(rows);
    } catch (err) {
        console.error('Database error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/items/itemId/:itemId', async (req, res) => {
    const itemId = req.params.itemId;
    try{
        const [rows] = await db.query('SELECT * FROM items WHERE item_id = ?', [itemId]);
        res.json(rows);
    } catch (err) {
        console.error('database error:' + err.message);
        res.status(500).json({ error: 'Database error' });
    }
});


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
    const imageUrl = uploadedImage.name;



    const { name, description, price, condition, size, ISBN, owner_id} = req.body;
    console.log('[UPLOAD/ITEM] Request received with data:', { name, description, price, condition, size, ISBN, image_url, owner_id });
    try {
        console.log('[UPLOAD/ITEM] Inserting item into database...');
        await db.query(
            'INSERT INTO items (`name`, `description`, `price`, `condition`, `size`, `isbn`, `image`, `owner_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, description, price, condition, size, ISBN, image_url, owner_id]
        );
        console.log('[UPLOAD/ITEM] Success - Item inserted into database');
        try {
            await uploadedImage.mv(uploadPath);
            console.log(`[UPLOAD/IMAGE] Success - File saved to: ${uploadPath}, URL: ${imageUrl}`);
        } catch (err) {
            console.error(`[UPLOAD/IMAGE] Error moving file: ${err.message}`);
            await db.query('DELETE FROM items WHERE `name` = ? AND `description` = ? AND `price` = ? AND `condition` = ? AND `size` = ? AND `isbn` = ? AND `image` = ? AND `owner_id` = ?',
            [name, description, price, condition, size, ISBN, image_url, owner_id]);
            return res.status(500).json({ success: false, message: 'Image upload failed, item removed from database' });
        }
        res.json({ success: true, message: 'Item uploaded successfully' });
    } catch (err) {
        console.error('[UPLOAD/ITEM] Database error:', err.message);
        res.status(500).json({success: "false", error: 'Database error' });
    }

});

app.post('/api/items/upload/image', async (req, res) => {
    console.log('[UPLOAD/IMAGE] Request received');
    if (!req.files || Object.keys(req.files).length === 0) {
        console.log('[UPLOAD/IMAGE] No files provided in request');
        return res.status(500).json({ success: false, message: 'No file uploaded' });
    }

    const uploadedImage = req.files.image;
    console.log(`[UPLOAD/IMAGE] File received: ${uploadedImage.name}, Size: ${uploadedImage.size} bytes`);

    const uploadPath = path.join(__dirname, '..', 'frontend', 'images', uploadedImage.name);
    console.log(`[UPLOAD/IMAGE] Target path: ${uploadPath}`);

    try {
        await uploadedImage.mv(uploadPath);
        const imageUrl = `/images/${uploadedImage.name}`;
        console.log(`[UPLOAD/IMAGE] Success - File saved to: ${uploadPath}, URL: ${imageUrl}`);
        res.json({ success: true, message: 'Image uploaded successfully', imageUrl: imageUrl });

    } catch (err) {
        console.error(`[UPLOAD/IMAGE] Error moving file: ${err.message}`);
        res.status(500).json({ success: false, message: 'Image upload failed' });
    }
});

app.post('/sendEmail', async (req, res) => {
    const { senderId, recipientId, itemId, content } = req.body;
    console.log("message request received with data: " + senderId + recipientId + itemId + content);
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
    const mail = {
        from: process.env.EMAIL_USER,
        to: recipient.email,
        subject: `Message from user "${sender.user_name}" about your listing "${item.name}"`,
        text: `${sender.user_name}'s message:\n ${content} +\n\nReply to ${sender.user_name} via text on ${sender.phone} to respond to this offer.`
    }
    console.log(JSON.stringify(mail));
    res.json({ success: true, message: 'Email sent successfully' });
    // emailer.sendMail(mail, (err, info) => {
    //     if (err) {
    //         console.error('Error sending email:', err.message);
    //     } else {
    //         console.log('Email sent:', info.response);
    //     }
});

app.get('/api/session', (req, res) => {
    // console.log(req.session.userEmail);
    if (req.session.user !== null && req.session.user !== undefined) {
        console.log(req.session.user.email == "logged in");
        res.json({ loggedIn: true, user: req.session.user.userEmail, userId: req.session.user.user_id});
    } else {
        console.log("logged out");
        res.json({ loggedIn: false });
        
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));
