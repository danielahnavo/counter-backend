const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// CONFIG
const BASE_VALUE = 17000000;
const DAILY_INCREASE = 7945.21;
const START_DATE = new Date("2025-01-01");

app.get('/counter', (req, res) => {
  const now = new Date();

  const daysElapsed = Math.floor(
    (now - START_DATE) / (1000 * 60 * 60 * 24)
  );

  const dailyTotal = daysElapsed * DAILY_INCREASE;

  const total = BASE_VALUE + dailyTotal;

  res.json({
    endValue: Number(total.toFixed(2))
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});