const express = require("express");
const axios = require("axios");
const { DateTime } = require("luxon");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// CONFIG
// =========================
const BASE_VALUE = 17015632;
const DAILY_FIXED_INCREASE = 7945.21;

// IMPORTANT:
// If 17,015,632 is the number as of TODAY before today's increase,
// leave START_DATE as today's date.
// Then the first +7945.21 gets added after today finishes.
const START_DATE = "2026-04-03";

const BUSINESS_TIMEZONE = "America/Los_Angeles";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

// =========================
// TOKEN CACHE
// =========================
let cachedToken = null;
let cachedTokenExpiresAt = 0;

// =========================
// HELPERS
// =========================
function roundCurrency(value) {
  return Number((value || 0).toFixed(2));
}

async function getShopifyAccessToken() {
  const nowMs = Date.now();

  if (cachedToken && nowMs < cachedTokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SHOPIFY_CLIENT_ID,
    client_secret: SHOPIFY_CLIENT_SECRET,
  });

  const response = await axios.post(url, body.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    timeout: 30000,
  });

  const accessToken = response.data?.access_token;
  const expiresIn = Number(response.data?.expires_in || 0);

  if (!accessToken) {
    throw new Error(`No access token returned: ${JSON.stringify(response.data)}`);
  }

  cachedToken = accessToken;
  cachedTokenExpiresAt = Date.now() + expiresIn * 1000;

  return cachedToken;
}

async function shopifyGraphQL(query, variables = {}) {
  const accessToken = await getShopifyAccessToken();

  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      timeout: 30000,
    }
  );

  if (response.data.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(response.data.errors)}`);
  }

  if (!response.data?.data) {
    throw new Error(`Unexpected Shopify response: ${JSON.stringify(response.data)}`);
  }

  return response.data.data;
}

async function fetchNetRevenueForRange(startDateTimeISO, endDateTimeISO) {
  let hasNextPage = true;
  let cursor = null;
  let totalNetRevenue = 0;

  const queryString = `created_at:>=${startDateTimeISO} created_at:<${endDateTimeISO} test:false`;

  const query = `
    query GetOrdersForCounter($first: Int!, $after: String, $query: String!) {
      orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            id
            createdAt
            currentSubtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  `;

  while (hasNextPage) {
    const data = await shopifyGraphQL(query, {
      first: 250,
      after: cursor,
      query: queryString,
    });

    const edges = data.orders?.edges || [];

    for (const edge of edges) {
      const amount = Number(edge.node?.currentSubtotalPriceSet?.shopMoney?.amount || 0);
      totalNetRevenue += amount;
    }

    hasNextPage = Boolean(data.orders?.pageInfo?.hasNextPage);
    cursor = edges.length ? edges[edges.length - 1].cursor : null;
  }

  return roundCurrency(totalNetRevenue);
}

// =========================
// ROUTES
// =========================
app.get("/", (req, res) => {
  res.send("Counter API is running");
});

app.get("/counter", async (req, res) => {
  try {
    const now = DateTime.now().setZone(BUSINESS_TIMEZONE);

    // Only count COMPLETED days
    const todayStart = now.startOf("day");
    const start = DateTime.fromISO(START_DATE, { zone: BUSINESS_TIMEZONE }).startOf("day");

    const completedDays = Math.max(
      0,
      Math.floor(todayStart.diff(start, "days").days)
    );

    // Pull revenue from START_DATE up to start of today
    // so only completed days are included
    const startDateTimeISO = start.toUTC().toISO();
    const endDateTimeISO = todayStart.toUTC().toISO();

    const cumulativeNetRevenue = await fetchNetRevenueForRange(
      startDateTimeISO,
      endDateTimeISO
    );

    const fixedIncreaseTotal = completedDays * DAILY_FIXED_INCREASE;
    const revenueShareTotal = cumulativeNetRevenue * 0.2;

    const endValue =
      BASE_VALUE +
      fixedIncreaseTotal +
      revenueShareTotal;

    res.json({
      endValue: roundCurrency(endValue)
    });
  } catch (error) {
    console.error("Counter error:", error.response?.data || error.message);

    res.status(500).json({
      error: "Failed to calculate counter value.",
      details: error.response?.data || error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
