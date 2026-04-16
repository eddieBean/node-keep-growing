const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.static('public'));

// API endpoint returning items as JSON
app.get('/api/items', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM items');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
