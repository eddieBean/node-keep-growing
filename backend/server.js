require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true })); // parses HTML form submissions
app.use(express.json());                          // parses JSON requests
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));



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
        req.session.userEmail = email;
        res.json({ success: true, message: 'Signup successful' });

    } catch (err) {
        console.error('Signup error', err.message);
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


app.get('/api/session', (req, res) => {
    console.log(req.session.userEmail);
    if (typeof req.session.userEmail === 'string') {
        console.log("logged in");
        res.json({ loggedIn: true, user: req.session.userEmail });
    } else {
        console.log("logged out");
        res.json({ loggedIn: false });
        
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));
