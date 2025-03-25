const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const shopRoutes = require("./routes/shopRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const orderRoutes = require("./routes/orderRoutes");
const midtransRoutes = require("./routes/midtransRoutes");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");

dotenv.config();
const app = express();

const corsOptions = {
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(helmet());
app.use(cors(corsOptions));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
});

app.use(limiter);

app.use(express.json({ limit: "10kb" }));
app.use(morgan("combined"));

app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", shopRoutes);
app.use("/api", productRoutes);
app.use("/api", cartRoutes);
app.use("/api", orderRoutes);
app.use("/api", midtransRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something went wrong!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
