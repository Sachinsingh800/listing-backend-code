import dns from "node:dns";
import "dotenv/config";

import cors from "cors";
import express from "express";
import mongoose from "mongoose";

import connectDatabase from "./config/db.mjs";
import productRoutes from "./routes/products.mjs";

dns.setServers([
  "8.8.8.8",
  "1.1.1.1",
]);

const app = express();

const port =
  Number(process.env.PORT) || 5000;

const clientOrigin =
  process.env.CLIENT_ORIGIN ||
  "http://localhost:3000";

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin: clientOrigin,

    methods: [
      "GET",
      "POST",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  }),
);

/*
|--------------------------------------------------------------------------
| JSON
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: "2mb",
  }),
);

/*
|--------------------------------------------------------------------------
| Request logger
|--------------------------------------------------------------------------
*/

app.use(
  (request, _response, next) => {
    console.log(
      `[${new Date().toISOString()}] ${request.method} ${request.originalUrl}`,
    );

    next();
  },
);

/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  (_request, response) => {
    response.json({
      success: true,

      status: "ok",

      database:
        mongoose.connection
          .readyState === 1
          ? "connected"
          : "disconnected",

      uptime:
        process.uptime(),

      timestamp:
        new Date().toISOString(),
    });
  },
);

/*
|--------------------------------------------------------------------------
| Product routes
|--------------------------------------------------------------------------
*/

app.use(
  "/api/products",
  productRoutes,
);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use(
  (request, response) => {
    response
      .status(404)
      .json({
        success: false,

        message:
          `Route not found: ${request.method} ${request.originalUrl}`,
      });
  },
);

/*
|--------------------------------------------------------------------------
| Global error handler
|--------------------------------------------------------------------------
*/

app.use(
  (
    error,
    _request,
    response,
    _next,
  ) => {
    console.error(
      "API ERROR:",
      error,
    );

    /*
     * Custom application errors
     */
    if (error.status) {
      return response
        .status(error.status)
        .json({
          success: false,

          message:
            error.message ||
            "Request failed.",
        });
    }

    /*
     * Mongoose validation
     */
    if (
      error.name ===
      "ValidationError"
    ) {
      return response
        .status(400)
        .json({
          success: false,

          message:
            error.message,
        });
    }

    /*
     * Invalid MongoDB ObjectId
     */
    if (
      error.name ===
      "CastError"
    ) {
      return response
        .status(400)
        .json({
          success: false,

          message:
            `Invalid ${error.path}.`,
        });
    }

    /*
     * Duplicate index
     */
    if (
      error.code === 11000
    ) {
      return response
        .status(409)
        .json({
          success: false,

          message:
            "A duplicate product value was detected.",

          fields:
            error.keyValue ||
            {},
        });
    }

    /*
     * MongoDB connection issue
     */
    if (
      error.name ===
      "MongoServerSelectionError"
    ) {
      return response
        .status(503)
        .json({
          success: false,

          message:
            "MongoDB is currently unavailable.",
        });
    }

    /*
     * Unknown error
     */
    return response
      .status(500)
      .json({
        success: false,

        message:
          "Something went wrong on the server.",
      });
  },
);

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

async function startServer() {
  try {
    await connectDatabase();

    app.listen(
      port,
      () => {
        console.log("");
        console.log(
          "========================================",
        );
        console.log(
          `API running: http://localhost:${port}`,
        );
        console.log(
          `Products:    http://localhost:${port}/api/products`,
        );
        console.log(
          `Dashboard:   http://localhost:${port}/api/products/dashboard`,
        );
        console.log(
          "========================================",
        );
        console.log("");
      },
    );
  } catch (error) {
    console.error(
      "Unable to start API:",
      error,
    );

    process.exit(1);
  }
}

startServer();

/*
|--------------------------------------------------------------------------
| Graceful shutdown
|--------------------------------------------------------------------------
*/

async function shutdown(
  signal,
) {
  console.log(
    `${signal} received. Closing MongoDB...`,
  );

  try {
    await mongoose.connection.close();

    console.log(
      "MongoDB connection closed.",
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "Shutdown error:",
      error,
    );

    process.exit(1);
  }
}

process.on(
  "SIGINT",
  () => void shutdown("SIGINT"),
);

process.on(
  "SIGTERM",
  () => void shutdown("SIGTERM"),
);