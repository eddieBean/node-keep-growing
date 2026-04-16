const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

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
/*
app.get('/api/items', async (req, res) => {
  res.json([{ id: 1, name: 'Test Item', description: 'Test desc', image_url: '', link: '#' }]);
});
*/
// serves your index.html
app.listen(3000, () => console.log('Server running on port 3000'));
