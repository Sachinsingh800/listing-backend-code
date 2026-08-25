import dns from "node:dns";
import "dotenv/config";

import cors from "cors";
import express from "express";
import mongoose from "mongoose";

import connectDatabase from "./config/db.mjs";
import productRoutes from "./routes/products.mjs";
import charmRoutes from "./routes/charms.mjs";
import designRoutes from "./routes/designs.mjs";

/*
|--------------------------------------------------------------------------
| DNS
|--------------------------------------------------------------------------
*/

dns.setServers([
  "8.8.8.8",
  "1.1.1.1",
]);

/*
|--------------------------------------------------------------------------
| App
|--------------------------------------------------------------------------
*/

const app = express();

const port =
  Number(process.env.PORT) || 5000;

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
|
| Render:
|
| CLIENT_ORIGIN=https://listing-tool-rose.vercel.app
|
| For local + production:
|
| CLIENT_ORIGIN=http://localhost:3000,https://listing-tool-rose.vercel.app
|
|--------------------------------------------------------------------------
*/

const allowedOrigins = (
  process.env.CLIENT_ORIGIN ||
  [
    "http://localhost:3000",
    "https://listing-tool-rose.vercel.app",
    "https://listing-tool-three.vercel.app",
  ].join(",")
)
  .split(",")
  .map((origin) =>
    origin.trim().replace(/\/$/, ""),
  )
  .filter(Boolean);

console.log(
  "Allowed CORS origins:",
  allowedOrigins,
);

/*
|--------------------------------------------------------------------------
| CORS Middleware
|--------------------------------------------------------------------------
*/

app.use(
  cors({
    origin(origin, callback) {
      /*
      |--------------------------------------------------------------------------
      | Requests like Postman/server-to-server may have no Origin.
      |--------------------------------------------------------------------------
      */

      if (!origin) {
        return callback(
          null,
          true,
        );
      }

      const normalizedOrigin =
        origin
          .trim()
          .replace(/\/$/, "");

      if (
        allowedOrigins.includes(
          normalizedOrigin,
        )
      ) {
        return callback(
          null,
          true,
        );
      }

      console.error(
        `CORS blocked origin: ${origin}`,
      );

      return callback(
        new Error(
          `CORS blocked origin: ${origin}`,
        ),
      );
    },

    methods: [
      "GET",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],

    credentials: false,

    optionsSuccessStatus: 204,
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
| Request Logger
|--------------------------------------------------------------------------
*/

app.use(
  (
    request,
    _response,
    next,
  ) => {
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
  (
    _request,
    response,
  ) => {
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

      cors: allowedOrigins,
    });
  },
);

/*
|--------------------------------------------------------------------------
| Products
|--------------------------------------------------------------------------
*/

app.use(
  "/api/products",
  productRoutes,
);

app.use(
  "/api/charms",
  charmRoutes,
);

app.use(
  "/api/designs",
  designRoutes,
);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use(
  (
    request,
    response,
  ) => {
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
| Global Error Handler
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
    |--------------------------------------------------------------------------
    | CORS
    |--------------------------------------------------------------------------
    */

    if (
      error.message?.startsWith(
        "CORS blocked origin:",
      )
    ) {
      return response
        .status(403)
        .json({
          success: false,

          message:
            "This frontend origin is not allowed by the API.",
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Custom Application Errors
    |--------------------------------------------------------------------------
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
    |--------------------------------------------------------------------------
    | Mongoose Validation
    |--------------------------------------------------------------------------
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
    |--------------------------------------------------------------------------
    | Invalid ObjectId
    |--------------------------------------------------------------------------
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
    |--------------------------------------------------------------------------
    | Duplicate MongoDB Key
    |--------------------------------------------------------------------------
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
    |--------------------------------------------------------------------------
    | MongoDB unavailable
    |--------------------------------------------------------------------------
    */

    if (
      error.name ===
        "MongoServerSelectionError" ||
      error.name ===
        "MongoNetworkError"
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
    |--------------------------------------------------------------------------
    | Unknown Error
    |--------------------------------------------------------------------------
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
      "0.0.0.0",
      () => {
        console.log("");
        console.log(
          "========================================",
        );
        console.log(
          `API running on port ${port}`,
        );
        console.log(
          `Products: /api/products`,
        );
        console.log(
          `Dashboard: /api/products/dashboard`,
        );
        console.log(
          "Allowed origins:",
        );
        console.log(
          allowedOrigins,
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
| Graceful Shutdown
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
  () =>
    void shutdown(
      "SIGINT",
    ),
);

process.on(
  "SIGTERM",
  () =>
    void shutdown(
      "SIGTERM",
    ),
);
