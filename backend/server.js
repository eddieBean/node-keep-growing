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


app.post('/signup', async (req, res) =>{
  
  const {email, password, phone} = req.body;
  console.log(req);
  try {
    //test if the email or phone number has already been used
    const[existingEmail] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existingEmail.length > 0){
      return res.send('An account with that email already exists')
    }
    const[existingPhone] = await db.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existingPhone.length > 0){
      return res.send('An account with that phone number already exists')
    }
    //hash the password before storing it in the db
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO users (email, password, phone) VALUES (?, ?)',
      [email, hashedPassword, phone]
    );
    req.session.userEmail = email;
    res.redirect('/');

  } catch (err) {
    console.error('Signup error', err.message);
    res.status(500).send('Signup failed')
  }
});

app.post('/login', async (req, res) =>{
  const { email, password} = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if(rows.length === 0){
      return res.send('no account with that email exists')
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match){
      return res.send('Incorrect Password');
    }

    req.session.userEmail = email;
    res.redirect('/frontend/index.html');

  } catch (err) {
    console.error('Signup error', err.message);
    res.status(500).send('Signup failed')
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
})

// API endpoint returning items as JSON
app.get('/api/items', async (req, res) => {
  console.log(req.query.item)
  try {
    const [rows] = await db.query('SELECT * FROM items');
    res.json(rows);
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
