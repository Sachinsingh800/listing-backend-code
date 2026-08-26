import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import * as XLSX from "xlsx";

import Product from "../models/Product.mjs";
import Charm from "../models/Charm.mjs";
import Design from "../models/Design.mjs";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Spreadsheet upload
|
| The workbook stays in memory and is never written to the server.  This is
| important because listing exports often contain thousands of product rows.
|--------------------------------------------------------------------------
*/

const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
  fileFilter(_request, file, callback) {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname || "")) {
      callback(null, true);
      return;
    }

    callback(
      badRequest("Upload an Excel (.xlsx or .xls) or CSV file."),
    );
  },
});

/*
|--------------------------------------------------------------------------
| Allowed Product Fields
|--------------------------------------------------------------------------
*/

const PRODUCT_FIELDS = [
  "productName",
  "description",
  "brand",
  "category",
  "material",
  "color",
  "theme",
  "type",

  "price",
  "mrp",
  "gst",
  "hsn",

  "weight",
  "inventory",

  "country",

  "manufacturer",
  "manufacturerAddress",
  "manufacturerPincode",

  "packer",
  "packerAddress",
  "packerPincode",

  "importer",
  "importerAddress",
  "importerPincode",

  "genericName",
  "size",
  "quantity",

  "length",
  "width",

  "designName",
  "designCode",
  "designNumber",
  "designId",
  "sku",

  "printType",
  "finish",
  "version",

  "image1",
  "image2",
  "image3",
  "image4",

  "groupId",

  "models",

  "parentId",
  "variantNumber",
  "variantType",
];

/*
|--------------------------------------------------------------------------
| Constants
|--------------------------------------------------------------------------
*/

const FIRST_DESIGN_NUMBER = 317;

/*
|--------------------------------------------------------------------------
| ID
|--------------------------------------------------------------------------
*/

function validId(id) {
  return mongoose.isObjectIdOrHexString(id);
}

/*
|--------------------------------------------------------------------------
| REGEX
|--------------------------------------------------------------------------
*/

function escapeRegex(value) {
  return String(value)
    .trim()
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
}

function exactCaseInsensitive(value) {
  return new RegExp(
    `^${escapeRegex(value)}$`,
    "i",
  );
}

/*
|--------------------------------------------------------------------------
| Pick allowed product data
|--------------------------------------------------------------------------
*/

function productData(body = {}) {
  return Object.fromEntries(
    PRODUCT_FIELDS
      .filter((field) =>
        Object.hasOwn(body, field),
      )
      .map((field) => [
        field,
        body[field],
      ]),
  );
}

/*
|--------------------------------------------------------------------------
| Errors
|--------------------------------------------------------------------------
*/

function badRequest(message) {
  const error = new Error(message);

  error.status = 400;

  return error;
}

function conflict(message) {
  const error = new Error(message);

  error.status = 409;

  return error;
}

function notFound(message) {
  const error = new Error(message);

  error.status = 404;

  return error;
}

/*
|--------------------------------------------------------------------------
| Serialize
|--------------------------------------------------------------------------
*/

function serializeProduct(product) {
  if (!product) {
    return null;
  }

  const data =
    typeof product.toObject ===
    "function"
      ? product.toObject()
      : {
          ...product,
        };

  const id =
    data._id?.toString();

  delete data._id;
  delete data.__v;

  if (data.parentId) {
    data.parentId =
      data.parentId.toString();
  }

  if (data.designId) {
    data.designId =
      data.designId.toString();
  }

  return {
    ...data,
    id,
  };
}

function serializeProductWithMeta(product) {
  const data =
    serializeProduct(product);

  const image =
    data?.image1 ||
    data?.image2 ||
    data?.image3 ||
    data?.image4 ||
    "";

  const inventory =
    Number(
      data?.inventory || 0,
    );

  let stockStatus =
    "in-stock";

  if (inventory <= 0) {
    stockStatus =
      "out-of-stock";
  } else if (inventory <= 20) {
    stockStatus =
      "low-stock";
  }

  return {
    ...data,

    image,

    isVariant:
      Boolean(data?.parentId),

    stockStatus,
  };
}

/*
|--------------------------------------------------------------------------
| Normalize
|--------------------------------------------------------------------------
*/

function normalizeProductData(data) {
  const normalized = {
    ...data,
  };

  const trimFields = [
    "productName",
    "designName",
    "designNumber",
    "groupId",
    "brand",
    "category",
    "material",
    "color",
    "theme",
    "type",
    "hsn",
    "country",
    "manufacturer",
    "manufacturerAddress",
    "manufacturerPincode",
    "packer",
    "packerAddress",
    "packerPincode",
    "importer",
    "importerAddress",
    "importerPincode",
    "genericName",
    "size",
    "printType",
    "finish",
    "variantType",
  ];

  for (const field of trimFields) {
    if (
      normalized[field] !==
        undefined &&
      normalized[field] !==
        null
    ) {
      normalized[field] =
        String(
          normalized[field],
        ).trim();
    }
  }

  if (
    normalized.designCode !==
      undefined &&
    normalized.designCode !==
      null
  ) {
    normalized.designCode =
      String(
        normalized.designCode,
      )
        .trim()
        .toUpperCase();
  }

  if (
    normalized.sku !==
      undefined &&
    normalized.sku !==
      null
  ) {
    normalized.sku =
      String(
        normalized.sku,
      )
        .trim()
        .toUpperCase();
  }

  if (
    normalized.designId !==
      undefined &&
    normalized.designId !==
      null
  ) {
    normalized.designId =
      String(
        normalized.designId,
      ).trim();

    if (!normalized.designId) {
      delete normalized.designId;
    }
  }

  return normalized;
}

async function applyDesignReference(
  data,
  session = null,
) {
  if (!data.designId) {
    return null;
  }

  if (!validId(data.designId)) {
    throw badRequest(
      "Invalid saved Design ID.",
    );
  }

  let query =
    Design.findById(data.designId)
      .lean();

  if (session) {
    query = query.session(session);
  }

  const design = await query;

  if (!design) {
    throw badRequest(
      "The selected saved Design no longer exists.",
    );
  }

  data.designId = design._id;
  data.designName = design.designName;
  data.designCode = design.designCode;

  return design;
}

/*
|--------------------------------------------------------------------------
| With-charm product defaults
|--------------------------------------------------------------------------
|
| A charm product is stored as a variant. It keeps the original product's
| fields and Design Number, but needs a different design name, title, and
| SKU. These helpers create sensible defaults when the frontend does not
| provide its own values.
|--------------------------------------------------------------------------
*/

function alreadyMentionsCharms(value) {
  return /\bwith\s+charms?\b/i.test(
    String(value || ""),
  );
}

function withCharmDesignName(designName) {
  const name =
    String(designName || "").trim();

  if (!name || alreadyMentionsCharms(name)) {
    return name;
  }

  return `${name} With Charms`;
}

function withCharmProductName(productName) {
  const title =
    String(productName || "").trim();

  if (!title || alreadyMentionsCharms(title)) {
    return title;
  }

  /*
  |--------------------------------------------------------------------------
  | Keep "Print" at the end when the original title has one:
  |
  | Aesthetic Floral Print
  | Aesthetic Floral With Charms Print
  |--------------------------------------------------------------------------
  */

  const printIndex =
    title.toLowerCase().lastIndexOf(
      " print",
    );

  if (printIndex >= 0) {
    return `${
      title.slice(
        0,
        printIndex,
      )
    } With Charms${
      title.slice(printIndex)
    }`;
  }

  return `${title} With Charms`;
}

function withCharmSku(sku) {
  const originalSku =
    String(sku || "")
      .trim()
      .toUpperCase();

  if (!originalSku || /\bWITH[\s-]+CHRM(?:S)?\b/i.test(originalSku)) {
    return originalSku;
  }

  /*
  |--------------------------------------------------------------------------
  | Put the charm marker immediately before the ending design/version part.
  |
  | MC-AP-IP13-UVV-APF-WL-TRNSPT-117.1.V1
  | MC-AP-IP13-UVV-APF-WL-TRNSPT-WITH CHRM-117.1.V1
  |--------------------------------------------------------------------------
  */

  const versionMatch =
    originalSku.match(
      /-(\d+(?:\.\d+)*\.V\d+)$/i,
    );

  if (versionMatch?.index !== undefined) {
    return `${
      originalSku.slice(
        0,
        versionMatch.index,
      )
    }-WITH CHRM${
      originalSku.slice(
        versionMatch.index,
      )
    }`;
  }

  return `${originalSku}-WITH CHRM`;
}

/*
|--------------------------------------------------------------------------
| Validate Product
|--------------------------------------------------------------------------
*/

function validateProductData(
  data,
  label = "Product",
) {
  if (
    !data.productName?.trim()
  ) {
    throw badRequest(
      `${label} name is required.`,
    );
  }

  if (
    !data.designName?.trim()
  ) {
    throw badRequest(
      `${label} design name is required.`,
    );
  }

  if (
    !data.designCode?.trim()
  ) {
    throw badRequest(
      `${label} design code is required.`,
    );
  }

  if (
    !data.designNumber?.trim()
  ) {
    throw badRequest(
      `${label} design number is required.`,
    );
  }

  if (!data.sku?.trim()) {
    throw badRequest(
      `${label} SKU is required.`,
    );
  }

  if (!data.groupId?.trim()) {
    throw badRequest(
      `${label} group ID is required.`,
    );
  }

  if (
    !Array.isArray(data.models) ||
    data.models.length === 0
  ) {
    throw badRequest(
      `${label} must contain at least one phone model.`,
    );
  }
}

/*
|--------------------------------------------------------------------------
| Validate Parent
|--------------------------------------------------------------------------
*/

async function validateParentId(
  parentId,
  session = null,
) {
  if (!parentId) {
    return null;
  }

  if (!validId(parentId)) {
    throw badRequest(
      "Invalid parent product ID.",
    );
  }

  let query =
    Product.findById(parentId)
      .select(
        "_id parentId productName",
      )
      .lean();

  if (session) {
    query =
      query.session(session);
  }

  const parent =
    await query;

  if (!parent) {
    throw notFound(
      "Parent product not found.",
    );
  }

  if (parent.parentId) {
    throw badRequest(
      "A variant cannot be used as another variant parent.",
    );
  }

  return parent;
}

/*
|--------------------------------------------------------------------------
| Duplicate Parent Product Check
|--------------------------------------------------------------------------
*/

async function ensureUniqueParentProduct(
  data,
  excludedId = null,
  session = null,
) {
  if (data.parentId) {
    return;
  }

  const rootFilter = {
    parentId: {
      $exists: false,
    },
  };

  if (excludedId) {
    rootFilter._id = {
      $ne: excludedId,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Product Title
  |--------------------------------------------------------------------------
  */

  if (data.productName?.trim()) {
    const filter = {
      ...rootFilter,

      productName:
        exactCaseInsensitive(
          data.productName,
        ),
    };

    let query =
      Product.exists(filter);

    if (session) {
      query =
        query.session(session);
    }

    if (await query) {
      throw conflict(
        "This product title already exists.",
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Design Code
  |--------------------------------------------------------------------------
  */

  if (
    data.designCode?.trim() &&
    !data.designId
  ) {
    const filter = {
      ...rootFilter,

      designCode:
        exactCaseInsensitive(
          data.designCode,
        ),
    };

    let query =
      Product.exists(filter);

    if (session) {
      query =
        query.session(session);
    }

    if (await query) {
      throw conflict(
        "This Design Code is already used by another product.",
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| Duplicate Identifier Check
|--------------------------------------------------------------------------
|
| Parent:
|   Design Number + SKU
|
| Variant:
|   SKU only
|
| Variants intentionally share their parent's
| Design Number.
|--------------------------------------------------------------------------
*/

async function ensureUniqueIdentifiers(
  records,
  session = null,
  options = {},
) {
  const checkDesignNumber =
    options.checkDesignNumber !== false;

  /*
  |--------------------------------------------------------------------------
  | Only parents check Design Number
  |--------------------------------------------------------------------------
  */

  const parentRecords =
    records.filter(
      (record) =>
        !record.parentId,
    );

  const parentDesignNumbers =
    checkDesignNumber
      ? parentRecords
          .map((record) =>
            String(
              record.designNumber ||
                "",
            ).trim(),
          )
          .filter(Boolean)
      : [];

  /*
  |--------------------------------------------------------------------------
  | Find duplicate inside same request
  |--------------------------------------------------------------------------
  */

  function findDuplicate(values) {
    const seen =
      new Set();

    for (const value of values) {
      const normalized =
        String(value)
          .trim()
          .toLowerCase();

      if (
        seen.has(normalized)
      ) {
        return value;
      }

      seen.add(normalized);
    }

    return null;
  }

  const duplicateDesignNumber =
    findDuplicate(
      parentDesignNumbers,
    );

  if (duplicateDesignNumber) {
    throw conflict(
      `Design Number "${duplicateDesignNumber}" is duplicated in this save request.`,
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Check Design Number directly in MongoDB
  |--------------------------------------------------------------------------
  */

  if (
    parentDesignNumbers.length >
    0
  ) {
    let query =
      Product.exists({
        parentId: {
          $exists: false,
        },

        designNumber: {
          $in:
            parentDesignNumbers,
        },
      });

    if (session) {
      query =
        query.session(session);
    }

    if (await query) {
      throw conflict(
        "This Design Number already exists in the database. The product was not saved.",
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | All products + variants check SKU
  |--------------------------------------------------------------------------
  */

  const skus =
    records
      .map((record) =>
        String(
          record.sku || "",
        )
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

  const duplicateSku =
    findDuplicate(skus);

  if (duplicateSku) {
    throw conflict(
      `SKU "${duplicateSku}" is duplicated in this save request.`,
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Check SKU directly in MongoDB
  |--------------------------------------------------------------------------
  */

  if (skus.length > 0) {
    let query =
      Product.exists({
        sku: {
          $in: skus,
        },
      });

    if (session) {
      query =
        query.session(session);
    }

    if (await query) {
      throw conflict(
        `SKU "${duplicateSku || skus[0]}" already exists in the database. The product was not saved.`,
      );
    }
  }
}

/*
|--------------------------------------------------------------------------
| NEXT AVAILABLE PARENT DESIGN NUMBER
|
| GET /api/products/next-design-number
|
| RULE:
|
| Start = 317
|
| Database:
| 317
| 318
| 320
|
| Response:
| 319
|
| Variants are ignored because only parents consume
| Design Numbers.
|--------------------------------------------------------------------------
*/

router.get(
  "/next-design-number",
  async (
    _request,
    response,
    next,
  ) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | Read every parent Design Number directly from MongoDB
      |--------------------------------------------------------------------------
      */

      const parents =
        await Product.find({
          parentId: {
            $exists: false,
          },

          designNumber: {
            $exists: true,

            $nin: [
              "",
              null,
            ],
          },
        })
          .select(
            "designNumber",
          )
          .lean();

      /*
      |--------------------------------------------------------------------------
      | Build set of used numbers
      |--------------------------------------------------------------------------
      */

      const usedNumbers =
        new Set();

      for (
        const parent of parents
      ) {
        const numeric =
          Number(
            String(
              parent.designNumber ??
                "",
            ).trim(),
          );

        if (
          Number.isInteger(
            numeric,
          ) &&
          numeric >=
            FIRST_DESIGN_NUMBER
        ) {
          usedNumbers.add(
            numeric,
          );
        }
      }

      /*
      |--------------------------------------------------------------------------
      | Find FIRST available number
      |--------------------------------------------------------------------------
      */

      let nextNumber =
        FIRST_DESIGN_NUMBER;

      while (
        usedNumbers.has(
          nextNumber,
        )
      ) {
        nextNumber += 1;
      }

      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      response.json({
        success: true,

        designNumber:
          String(nextNumber),

        usedDesignNumbers:
          Array.from(
            usedNumbers,
          ).sort(
            (a, b) =>
              a - b,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| CHECK DESIGN NUMBER AVAILABILITY
|
| GET /api/products/design-number-available?designNumber=319
|--------------------------------------------------------------------------
*/

router.get(
  "/design-number-available",
  async (
    request,
    response,
    next,
  ) => {
    try {
      const designNumber =
        String(
          request.query
            .designNumber ??
            "",
        ).trim();

      if (!designNumber) {
        throw badRequest(
          "Design Number is required.",
        );
      }

      const existingProduct =
        await Product.exists({
          parentId: {
            $exists: false,
          },
          designNumber,
        });

      response.json({
        success: true,

        designNumber,

        available:
          !existingProduct,
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| DASHBOARD
|--------------------------------------------------------------------------
*/

router.get(
  "/dashboard",
  async (
    _request,
    response,
    next,
  ) => {
    try {
      const [
        totalProducts,
        totalVariants,
        totalRecords,

        inventoryResult,
        valueResult,
        priceResult,

        lowStock,
        outOfStock,

        categories,
        brands,

        recentProducts,
      ] =
        await Promise.all([
          Product.countDocuments({
            parentId: {
              $exists: false,
            },
          }),

          Product.countDocuments({
            parentId: {
              $exists: true,
            },
          }),

          Product.countDocuments(),

          /*
          |--------------------------------------------------------------------------
          | Inventory
          |--------------------------------------------------------------------------
          */

          Product.aggregate([
            {
              $group: {
                _id: null,

                total: {
                  $sum: {
                    $ifNull: [
                      "$inventory",
                      0,
                    ],
                  },
                },
              },
            },
          ]),

          /*
          |--------------------------------------------------------------------------
          | Inventory Value
          |--------------------------------------------------------------------------
          */

          Product.aggregate([
            {
              $project: {
                inventory: {
                  $ifNull: [
                    "$inventory",
                    0,
                  ],
                },

                price: {
                  $ifNull: [
                    "$price",
                    0,
                  ],
                },
              },
            },

            {
              $group: {
                _id: null,

                value: {
                  $sum: {
                    $multiply: [
                      "$inventory",
                      "$price",
                    ],
                  },
                },
              },
            },
          ]),

          /*
          |--------------------------------------------------------------------------
          | Price
          |--------------------------------------------------------------------------
          */

          Product.aggregate([
            {
              $group: {
                _id: null,

                minimum: {
                  $min: {
                    $ifNull: [
                      "$price",
                      0,
                    ],
                  },
                },

                maximum: {
                  $max: {
                    $ifNull: [
                      "$price",
                      0,
                    ],
                  },
                },

                average: {
                  $avg: {
                    $ifNull: [
                      "$price",
                      0,
                    ],
                  },
                },
              },
            },
          ]),

          Product.countDocuments({
            inventory: {
              $gt: 0,
              $lte: 20,
            },
          }),

          Product.countDocuments({
            inventory: {
              $lte: 0,
            },
          }),

          /*
          |--------------------------------------------------------------------------
          | Categories
          |--------------------------------------------------------------------------
          */

          Product.aggregate([
            {
              $match: {
                category: {
                  $exists: true,

                  $nin: [
                    "",
                    null,
                  ],
                },
              },
            },

            {
              $group: {
                _id: "$category",

                count: {
                  $sum: 1,
                },

                stock: {
                  $sum: {
                    $ifNull: [
                      "$inventory",
                      0,
                    ],
                  },
                },

                value: {
                  $sum: {
                    $multiply: [
                      {
                        $ifNull: [
                          "$inventory",
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          "$price",
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            },

            {
              $sort: {
                count: -1,
              },
            },
          ]),

          /*
          |--------------------------------------------------------------------------
          | Brands
          |--------------------------------------------------------------------------
          */

          Product.aggregate([
            {
              $match: {
                brand: {
                  $exists: true,

                  $nin: [
                    "",
                    null,
                  ],
                },
              },
            },

            {
              $group: {
                _id: "$brand",

                count: {
                  $sum: 1,
                },

                stock: {
                  $sum: {
                    $ifNull: [
                      "$inventory",
                      0,
                    ],
                  },
                },

                value: {
                  $sum: {
                    $multiply: [
                      {
                        $ifNull: [
                          "$inventory",
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          "$price",
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            },

            {
              $sort: {
                count: -1,
              },
            },
          ]),

          /*
          |--------------------------------------------------------------------------
          | Recent Parent Products
          |--------------------------------------------------------------------------
          */

          Product.find({
            parentId: {
              $exists: false,
            },
          })
            .sort({
              createdAt: -1,
            })
            .limit(6)
            .lean(),
        ]);

      const price =
        priceResult[0] || {};

      /*
      |--------------------------------------------------------------------------
      | Extended catalog, model, charm and activity analytics
      |--------------------------------------------------------------------------
      */

      const now =
        Date.now();

      const sevenDaysAgo =
        new Date(
          now -
            7 *
              24 *
              60 *
              60 *
              1000,
        );

      const thirtyDaysAgo =
        new Date(
          now -
            30 *
              24 *
              60 *
              60 *
              1000,
        );

      const [
        totalCharms,
        charmSourceIds,
        parentIdsWithVariants,
        phoneModels,
        newProducts7Days,
        newProducts30Days,
        newCharms30Days,
        priceIntelligenceRows,
        topModelRows,
        charmModelRows,
        recentCharmCountRows,
      ] =
        await Promise.all([
          Charm.countDocuments(),

          Charm.distinct(
            "sourceProductId",
            {
              sourceProductId: {
                $exists: true,
                $ne: null,
              },
            },
          ),

          Product.distinct(
            "parentId",
            {
              parentId: {
                $exists: true,
                $ne: null,
              },
            },
          ),

          Product.distinct(
            "models.model",
            {
              "models.model": {
                $exists: true,
                $nin: [
                  "",
                  null,
                ],
              },
            },
          ),

          Product.countDocuments({
            parentId: {
              $exists: false,
            },
            createdAt: {
              $gte: sevenDaysAgo,
            },
          }),

          Product.countDocuments({
            parentId: {
              $exists: false,
            },
            createdAt: {
              $gte: thirtyDaysAgo,
            },
          }),

          Charm.countDocuments({
            createdAt: {
              $gte: thirtyDaysAgo,
            },
          }),

          Product.aggregate([
            {
              $match: {
                price: {
                  $gt: 0,
                },
              },
            },
            {
              $project: {
                price: 1,
                mrp: {
                  $ifNull: [
                    "$mrp",
                    0,
                  ],
                },
                discount: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $ifNull: [
                            "$mrp",
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                    {
                      $multiply: [
                        {
                          $divide: [
                            {
                              $subtract: [
                                {
                                  $ifNull: [
                                    "$mrp",
                                    0,
                                  ],
                                },
                                "$price",
                              ],
                            },
                            {
                              $ifNull: [
                                "$mrp",
                                1,
                              ],
                            },
                          ],
                        },
                        100,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                averageMrp: {
                  $avg: "$mrp",
                },
                averageDiscount: {
                  $avg: "$discount",
                },
              },
            },
          ]),

          Product.aggregate([
            {
              $unwind: "$models",
            },
            {
              $match: {
                "models.model": {
                  $exists: true,
                  $nin: [
                    "",
                    null,
                  ],
                },
              },
            },
            {
              $group: {
                _id: "$models.model",
                records: {
                  $sum: 1,
                },
                parents: {
                  $sum: {
                    $cond: [
                      {
                        $eq: [
                          {
                            $ifNull: [
                              "$parentId",
                              null,
                            ],
                          },
                          null,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                variants: {
                  $sum: {
                    $cond: [
                      {
                        $ne: [
                          {
                            $ifNull: [
                              "$parentId",
                              null,
                            ],
                          },
                          null,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                inventory: {
                  $sum: {
                    $ifNull: [
                      "$inventory",
                      0,
                    ],
                  },
                },
                value: {
                  $sum: {
                    $multiply: [
                      {
                        $ifNull: [
                          "$inventory",
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          "$price",
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            },
            {
              $sort: {
                records: -1,
                inventory: -1,
              },
            },
            {
              $limit: 8,
            },
          ]),

          Charm.aggregate([
            {
              $unwind: "$models",
            },
            {
              $match: {
                "models.model": {
                  $exists: true,
                  $nin: [
                    "",
                    null,
                  ],
                },
              },
            },
            {
              $group: {
                _id: "$models.model",
                charms: {
                  $sum: 1,
                },
              },
            },
          ]),

          recentProducts.length
            ? Charm.aggregate([
                {
                  $match: {
                    sourceProductId: {
                      $in: recentProducts.map(
                        (product) =>
                          product._id,
                      ),
                    },
                  },
                },
                {
                  $group: {
                    _id: "$sourceProductId",
                    count: {
                      $sum: 1,
                    },
                  },
                },
              ])
            : [],
        ]);

      const healthyStock =
        Math.max(
          totalRecords -
            lowStock -
            outOfStock,
          0,
        );

      const charmProducts =
        charmSourceIds.filter(
          Boolean,
        ).length;

      const productsWithVariants =
        parentIdsWithVariants.filter(
          Boolean,
        ).length;

      const priceIntelligence =
        priceIntelligenceRows[0] ||
        {};

      const charmCountByModel =
        new Map(
          charmModelRows.map(
            (item) => [
              String(item._id),
              Number(
                item.charms || 0,
              ),
            ],
          ),
        );

      const recentCharmCountBySource =
        new Map(
          recentCharmCountRows.map(
            (item) => [
              item._id.toString(),
              Number(
                item.count || 0,
              ),
            ],
          ),
        );

      response.json({
        success: true,

        stats: {
          totalProducts,

          totalVariants,

          totalRecords,

          totalInventory:
            Number(
              inventoryResult[0]
                ?.total || 0,
            ),

          inventoryValue:
            Number(
              valueResult[0]?.value ||
                0,
            ),

          price: {
            minimum:
              Number(
                price.minimum ||
                  0,
              ),

            maximum:
              Number(
                price.maximum ||
                  0,
              ),

            average:
              Number(
                price.average ||
                  0,
              ),

            averageMrp:
              Number(
                priceIntelligence
                  .averageMrp ||
                  0,
              ),

            averageDiscount:
              Number(
                priceIntelligence
                  .averageDiscount ||
                  0,
              ),
          },

          lowStock,

          outOfStock,

          healthyStock,

          stockHealthPercentage:
            totalRecords > 0
              ? Number(
                  ((healthyStock / totalRecords) * 100).toFixed(1),
                )
              : 0,

          averageInventory:
            totalRecords > 0
              ? Number(
                  (Number(inventoryResult[0]?.total || 0) / totalRecords).toFixed(1),
                )
              : 0,

          productsWithVariants,

          productsWithoutVariants:
            Math.max(totalProducts - productsWithVariants, 0),

          variantCoveragePercentage:
            totalProducts > 0
              ? Number(((productsWithVariants / totalProducts) * 100).toFixed(1))
              : 0,

          averageVariantsPerProduct:
            totalProducts > 0
              ? Number((totalVariants / totalProducts).toFixed(1))
              : 0,

          totalCharms,

          charmProducts,

          productsWithoutCharms:
            Math.max(totalRecords - charmProducts, 0),

          charmCoveragePercentage:
            totalRecords > 0
              ? Number(((charmProducts / totalRecords) * 100).toFixed(1))
              : 0,

          averageCharmsPerProduct:
            charmProducts > 0
              ? Number((totalCharms / charmProducts).toFixed(1))
              : 0,

          modelCount:
            phoneModels.filter(Boolean).length,

          categoryCount:
            categories.length,

          brandCount:
            brands.length,

          newProducts7Days,

          newProducts30Days,

          newCharms30Days,
        },

        topModels:
          topModelRows.map(
            (item) => ({
              name: item._id,
              records: Number(item.records || 0),
              parents: Number(item.parents || 0),
              variants: Number(item.variants || 0),
              inventory: Number(item.inventory || 0),
              value: Number(item.value || 0),
              charms:
                charmCountByModel.get(String(item._id)) || 0,
            }),
          ),

        categories:
          categories.map(
            (item) => ({
              name:
                item._id,

              count:
                item.count,

              stock:
                item.stock,

              value:
                Number(item.value || 0),
            }),
          ),

        brands:
          brands.map(
            (item) => ({
              name:
                item._id,

              count:
                item.count,

              stock:
                item.stock,

              value:
                Number(item.value || 0),
            }),
          ),

        recentProducts:
          recentProducts.map((product) => ({
            ...serializeProductWithMeta(product),
            charmCount:
              recentCharmCountBySource.get(
                product._id.toString(),
              ) || 0,
          })),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| DASHBOARD PRICE API
|--------------------------------------------------------------------------
*/

router.get(
  "/dashboard/prices",
  async (
    _request,
    response,
    next,
  ) => {
    try {
      const [
        summary,
        products,
      ] =
        await Promise.all([
          Product.aggregate([
            {
              $group: {
                _id: null,

                minimum: {
                  $min: {
                    $ifNull: [
                      "$price",
                      0,
                    ],
                  },
                },

                maximum: {
                  $max: {
                    $ifNull: [
                      "$price",
                      0,
                    ],
                  },
                },

                average: {
                  $avg: {
                    $ifNull: [
                      "$price",
                      0,
                    ],
                  },
                },

                count: {
                  $sum: 1,
                },
              },
            },
          ]),

          Product.find()
            .select(
              "_id productName price mrp inventory category brand parentId groupId designCode sku",
            )
            .sort({
              createdAt: -1,
            })
            .limit(500)
            .lean(),
        ]);

      const stats =
        summary[0] || {
          minimum: 0,
          maximum: 0,
          average: 0,
          count: 0,
        };

      response.json({
        success: true,

        stats: {
          minimum:
            Number(
              stats.minimum ||
                0,
            ),

          maximum:
            Number(
              stats.maximum ||
                0,
            ),

          average:
            Number(
              stats.average ||
                0,
            ),

          count:
            Number(
              stats.count ||
                0,
            ),
        },

        products:
          products.map(
            (product) => ({
              id:
                product._id.toString(),

              productName:
                product.productName,

              price:
                Number(
                  product.price ||
                    0,
                ),

              mrp:
                Number(
                  product.mrp ||
                    0,
                ),

              inventory:
                Number(
                  product.inventory ||
                    0,
                ),

              category:
                product.category,

              brand:
                product.brand,

              parentId:
                product.parentId
                  ? product.parentId.toString()
                  : undefined,

              groupId:
                product.groupId,

              designCode:
                product.designCode,

              sku:
                product.sku,
            }),
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| EXCEL / CSV IMPORT
|
| Supports the current Meesho template as well as older exports: instead of
| relying on a fixed sheet name or row number, it finds the row containing
| the product-name column and maps fields by their visible labels.
|--------------------------------------------------------------------------
*/

function cleanImportHeader(value) {
  return String(value || "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findImportColumn(headers, names) {
  return headers.findIndex((header) => {
    const normalized = cleanImportHeader(header);

    return names.some((name) =>
      normalized === name ||
      normalized.startsWith(`${name} `),
    );
  });
}

function importCell(row, headers, names) {
  const index = findImportColumn(headers, names);
  const value = index >= 0 ? row[index] : "";

  return value === undefined || value === null
    ? ""
    : String(value).trim();
}

function importNumber(row, headers, names, fallback = 0) {
  const value = Number(importCell(row, headers, names));

  return Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function designNumberFromSku(sku, fallback) {
  const match = String(sku || "").match(/-(\d+)(?:\.\d+)?\.V\d+$/i);

  return match?.[1] || String(fallback);
}

function designCodeFromSku(sku, fallback) {
  const value = String(sku || "").trim();

  return value
    .replace(/-\d+(?:\.\d+)?\.V\d+$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(-80)
    .toUpperCase() || `IMPORT-${fallback}`;
}

function mapImportRow(row, headers, rowNumber) {
  const sku = importCell(row, headers, ["sku id", "sku", "seller sku id"]);
  const styleId = importCell(row, headers, ["product id / style id", "style id", "product id"]);
  const productName = importCell(row, headers, ["product name", "title"]);
  const compatibleModels = importCell(row, headers, ["compatible models", "compatible model", "phone model"]);
  const designNumber = designNumberFromSku(sku || styleId, rowNumber);
  const designCode = designCodeFromSku(styleId || sku, rowNumber);

  return normalizeProductData({
    productName,
    description: importCell(row, headers, ["product description", "description"]),
    brand: importCell(row, headers, ["brand name", "brand"]),
    category: "Mobile Cases & Covers",
    material: importCell(row, headers, ["material"]),
    color: importCell(row, headers, ["color"]),
    theme: importCell(row, headers, ["theme"]),
    type: importCell(row, headers, ["type"]),
    price: importNumber(row, headers, ["meesho price", "price"]),
    mrp: importNumber(row, headers, ["mrp"]),
    gst: importNumber(row, headers, ["gst %", "gst"]),
    hsn: importCell(row, headers, ["hsn id", "hsn"]),
    weight: importNumber(row, headers, ["net weight (gms)", "weight"]),
    inventory: importNumber(row, headers, ["inventory", "stock"]),
    country: importCell(row, headers, ["country of origin", "country"]),
    manufacturer: importCell(row, headers, ["manufacturer name", "manufacturer"]),
    manufacturerAddress: importCell(row, headers, ["manufacturer address"]),
    manufacturerPincode: importCell(row, headers, ["manufacturer pincode"]),
    packer: importCell(row, headers, ["packer name", "packer"]),
    packerAddress: importCell(row, headers, ["packer address"]),
    packerPincode: importCell(row, headers, ["packer pincode"]),
    importer: importCell(row, headers, ["importer name", "importer"]),
    importerAddress: importCell(row, headers, ["importer address"]),
    importerPincode: importCell(row, headers, ["importer pincode"]),
    genericName: importCell(row, headers, ["generic name"]),
    size: importCell(row, headers, ["variation", "size"]),
    quantity: importNumber(row, headers, ["net quantity (n)", "quantity"], 1),
    length: importNumber(row, headers, ["product length (cm)", "length"]),
    width: importNumber(row, headers, ["product width(cm)", "width"]),
    designName: styleId || productName,
    designCode,
    designNumber,
    sku: sku || styleId,
    version: (String(sku || styleId).match(/\.V(\d+)$/i)?.[1]) || "1",
    image1: importCell(row, headers, ["image 1 (front)", "image 1"]),
    image2: importCell(row, headers, ["image 2"]),
    image3: importCell(row, headers, ["image 3"]),
    image4: importCell(row, headers, ["image 4"]),
    groupId: importCell(row, headers, ["group id"]) || `Imported-${designNumber}`,
    models: compatibleModels
      .split(/[,;|]/)
      .map((model) => model.trim())
      .filter(Boolean)
      .map((model) => ({ model })),
  });
}

router.post(
  "/import",
  spreadsheetUpload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file?.buffer) {
        throw badRequest('Attach the spreadsheet in a multipart field named "file".');
      }

      const workbook = XLSX.read(request.file.buffer, {
        type: "buffer",
        raw: false,
      });

      let imported = 0;
      let updated = 0;
      const errors = [];

      for (const sheetName of workbook.SheetNames) {
        /* Template reference, validation, and instruction sheets also contain
           product-like headings. They must never become live products. */
        if (/instruction|example|validation|return reason/i.test(sheetName)) {
          continue;
        }

        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          header: 1,
          defval: "",
          raw: false,
          blankrows: false,
        });
        const headerRowIndex = rows.findIndex((row) =>
          findImportColumn(row, ["product name", "title"]) >= 0,
        );

        if (headerRowIndex < 0) continue;

        const headers = rows[headerRowIndex];
        for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
          const row = rows[index];
          const productName = importCell(row, headers, ["product name", "title"]);
          if (!productName || /^tutorial link$/i.test(productName)) continue;

          try {
            const data = mapImportRow(row, headers, index + 1);
            validateProductData(data, `Row ${index + 1}`);

            const result = await Product.updateOne(
              { sku: data.sku },
              { $set: data },
              { upsert: true, runValidators: true, setDefaultsOnInsert: true },
            );

            if (result.upsertedCount) imported += 1;
            else if (result.modifiedCount) updated += 1;
          } catch (error) {
            errors.push({
              sheet: sheetName,
              row: index + 1,
              message: error.message || "Could not import this row.",
            });
          }
        }
      }

      if (!imported && !updated && !errors.length) {
        throw badRequest("No supported product table was found in this file.");
      }

      response.status(errors.length ? 207 : 200).json({
        success: errors.length === 0,
        message: "Spreadsheet import finished.",
        imported,
        updated,
        failed: errors.length,
        errors: errors.slice(0, 100),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| BATCH SAVE
|
| Parent + variants saved in ONE transaction.
|--------------------------------------------------------------------------
*/

router.post(
  "/batch",
  async (
    request,
    response,
    next,
  ) => {
    const session =
      await mongoose.startSession();

    try {
      const parent =
        request.body?.parent;

      const variants =
        request.body?.variants ||
        [];

      if (
        !parent ||
        typeof parent !==
          "object"
      ) {
        throw badRequest(
          "Parent product data is required.",
        );
      }

      if (
        !Array.isArray(
          variants,
        )
      ) {
        throw badRequest(
          "Variants must be an array.",
        );
      }

      session.startTransaction();

      /*
      |--------------------------------------------------------------------------
      | Parent
      |--------------------------------------------------------------------------
      */

      let parentData =
        normalizeProductData(
          productData(
            parent,
          ),
        );

      await applyDesignReference(
        parentData,
        session,
      );

      validateProductData(
        parentData,
        "Parent product",
      );

      delete parentData.parentId;

      delete parentData.variantNumber;

      parentData.version =
        "1";

      /*
      |--------------------------------------------------------------------------
      | Existing root title/design code check
      |--------------------------------------------------------------------------
      */

      await ensureUniqueParentProduct(
        parentData,
        null,
        session,
      );

      /*
      |--------------------------------------------------------------------------
      | Prepare variants
      |--------------------------------------------------------------------------
      */

      const preparedVariants =
        [];

      for (
        let index = 0;
        index <
        variants.length;
        index += 1
      ) {
        let variantData =
          normalizeProductData(
            productData(
              variants[index],
            ),
          );

        validateProductData(
          variantData,
          `Variant ${
            index + 1
          }`,
        );

        /*
        |--------------------------------------------------------------------------
        | Parent ID is assigned by server later.
        |--------------------------------------------------------------------------
        */

        delete variantData.parentId;

        variantData.variantNumber =
          Number(
            variantData.variantNumber,
          ) >= 2
            ? Number(
                variantData.variantNumber,
              )
            : index + 2;

        variantData.version =
          variantData.version ||
          String(
            variantData.variantNumber,
          );

        /*
        |--------------------------------------------------------------------------
        | Variant Design Number:
        |
        | MUST MATCH PARENT.
        |--------------------------------------------------------------------------
        */

        variantData.designNumber =
          parentData.designNumber;

        variantData.designId =
          parentData.designId;

        variantData.designName =
          parentData.designName;

        variantData.designCode =
          parentData.designCode;

        preparedVariants.push(
          variantData,
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Check parent Design Number + SKU
      |--------------------------------------------------------------------------
      */

      await ensureUniqueIdentifiers(
        [parentData],
        session,
        {
          checkDesignNumber:
            true,
        },
      );

      /*
      |--------------------------------------------------------------------------
      | Check variant SKUs
      |--------------------------------------------------------------------------
      */

      await ensureUniqueIdentifiers(
        preparedVariants,
        session,
        {
          checkDesignNumber:
            false,
        },
      );

      /*
      |--------------------------------------------------------------------------
      | Save parent
      |--------------------------------------------------------------------------
      */

      const [
        savedParent,
      ] =
        await Product.create(
          [parentData],
          {
            session,
          },
        );

      /*
      |--------------------------------------------------------------------------
      | Save variants
      |--------------------------------------------------------------------------
      */

      const savedVariants =
        [];

      for (
        const variantData of
          preparedVariants
      ) {
        variantData.parentId =
          savedParent._id;

        const [
          savedVariant,
        ] =
          await Product.create(
            [variantData],
            {
              session,
            },
          );

        savedVariants.push(
          savedVariant,
        );
      }

      await session.commitTransaction();

      response
        .status(201)
        .json({
          success: true,

          message:
            savedVariants.length >
            0
              ? "Product and variants saved successfully."
              : "Product saved successfully.",

          product:
            serializeProductWithMeta(
              savedParent,
            ),

          variants:
            savedVariants.map(
              serializeProductWithMeta,
            ),
        });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch {}

      /*
      |--------------------------------------------------------------------------
      | Better MongoDB duplicate error
      |--------------------------------------------------------------------------
      */

      if (
        error?.code ===
        11000
      ) {
        const duplicateField =
          Object.keys(
            error.keyPattern ||
              error.keyValue ||
              {},
          )[0];

        if (
          duplicateField ===
          "designNumber"
        ) {
          return next(
            conflict(
              "This Design Number already exists in the database. The product was not saved.",
            ),
          );
        }

        if (
          duplicateField ===
          "sku"
        ) {
          return next(
            conflict(
              "This SKU already exists in the database. The product was not saved.",
            ),
          );
        }
      }

      next(error);
    } finally {
      await session.endSession();
    }
  },
);

/*
|--------------------------------------------------------------------------
| CREATE SINGLE PRODUCT
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  async (
    request,
    response,
    next,
  ) => {
    try {
      let data =
        normalizeProductData(
          productData(
            request.body,
          ),
        );

      await applyDesignReference(data);

      validateProductData(
        data,
      );

      /*
      |--------------------------------------------------------------------------
      | Variant
      |--------------------------------------------------------------------------
      */

      if (data.parentId) {
        await validateParentId(
          data.parentId,
        );

        data.variantNumber =
          Number(
            data.variantNumber,
          ) >= 2
            ? Number(
                data.variantNumber,
              )
            : 2;

        data.version =
          data.version ||
          String(
            data.variantNumber,
          );

        /*
        |--------------------------------------------------------------------------
        | Variant Design Number must match parent
        |--------------------------------------------------------------------------
        */

        const parent =
          await Product.findById(
            data.parentId,
          )
            .select(
              "designId designName designCode designNumber",
            )
            .lean();

        if (!parent) {
          throw notFound(
            "Parent product not found.",
          );
        }

        data.designNumber =
          parent.designNumber;

        data.designId =
          parent.designId;

        data.designName =
          parent.designName;

        data.designCode =
          parent.designCode;

        await ensureUniqueIdentifiers(
          [data],
          null,
          {
            checkDesignNumber:
              false,
          },
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Parent
      |--------------------------------------------------------------------------
      */

      else {
        delete data.parentId;

        delete data.variantNumber;

        data.version =
          "1";

        await ensureUniqueParentProduct(
          data,
        );

        await ensureUniqueIdentifiers(
          [data],
          null,
          {
            checkDesignNumber:
              true,
          },
        );
      }

      const product =
        await Product.create(
          data,
        );

      response
        .status(201)
        .json({
          success: true,

          message:
            data.parentId
              ? "Variant created successfully."
              : "Product created successfully.",

          product:
            serializeProductWithMeta(
              product,
            ),
        });
    } catch (error) {
      if (
        error?.code ===
        11000
      ) {
        const field =
          Object.keys(
            error.keyPattern ||
              error.keyValue ||
              {},
          )[0];

        if (
          field ===
          "designNumber"
        ) {
          return next(
            conflict(
              "This Design Number already exists in the database.",
            ),
          );
        }

        if (
          field ===
          "sku"
        ) {
          return next(
            conflict(
              "This SKU already exists in the database.",
            ),
          );
        }
      }

      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| CREATE SEPARATE CHARM RECORD
|
| This route is intentionally registered before the legacy handler below.
| It copies the product into the independent `charms` collection and does
| not write to the `products` collection.
|--------------------------------------------------------------------------
*/

router.get(
  "/:id/charms",
  async (request, response, next) => {
    if (!validId(request.params.id)) {
      return response.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    try {
      const product = await Product.findById(request.params.id)
        .select("designNumber")
        .lean();

      if (!product) {
        throw notFound("Product not found.");
      }

      const charms = await Charm.find({
        designNumber: product.designNumber,
      })
        .sort({ createdAt: -1 })
        .lean();

      response.json({
        success: true,
        designNumber: product.designNumber,
        count: charms.length,
        charms: charms.map(serializeProductWithMeta),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/:id/charms/:charmId",
  async (request, response, next) => {
    if (!validId(request.params.id) || !validId(request.params.charmId)) {
      return response.status(400).json({
        success: false,
        message: "Invalid product or charm ID.",
      });
    }

    try {
      const product = await Product.findById(request.params.id)
        .select("designNumber")
        .lean();

      if (!product) {
        throw notFound("Product not found.");
      }

      const charm = await Charm.findOneAndDelete({
        _id: request.params.charmId,
        designNumber: product.designNumber,
      });

      if (!charm) {
        throw notFound("Charm not found for this product design.");
      }

      response.json({
        success: true,
        message: "Charm deleted. Product was not changed.",
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/:id/charms/:charmId",
  async (request, response, next) => {
    if (!validId(request.params.id) || !validId(request.params.charmId)) {
      return response.status(400).json({
        success: false,
        message: "Invalid product or charm ID.",
      });
    }

    try {
      const product = await Product.findById(request.params.id)
        .select("designNumber")
        .lean();

      if (!product) {
        throw notFound("Product not found.");
      }

      const update = normalizeProductData(productData(request.body));

      delete update.designNumber;
      delete update.parentId;
      delete update.variantNumber;
      delete update.variantType;

      const charm = await Charm.findOneAndUpdate(
        {
          _id: request.params.charmId,
          designNumber: product.designNumber,
        },
        { $set: update },
        {
          new: true,
          runValidators: true,
        },
      );

      if (!charm) {
        throw notFound("Charm not found for this product design.");
      }

      response.json({
        success: true,
        message: "Charm updated. Product was not changed.",
        charm: serializeProductWithMeta(charm),
      });
    } catch (error) {
      if (error?.code === 11000) {
        return next(conflict("This charm SKU already exists."));
      }

      next(error);
    }
  },
);

router.post(
  "/:id/with-charm",
  async (request, response, next) => {
    if (!validId(request.params.id)) {
      return response.status(400).json({ success: false, message: "Invalid product ID." });
    }

    try {
      const source = await Product.findById(request.params.id).lean();
      if (!source) throw notFound("Product not found.");

      const root = source.parentId
        ? await Product.findById(source.parentId).lean()
        : source;
      if (!root) throw notFound("Parent product not found.");

      const generatedData = {
        ...productData(serializeProduct(source)),
        designNumber: root.designNumber,
        designName: withCharmDesignName(source.designName),
        productName: withCharmProductName(source.productName),
        sku: withCharmSku(source.sku),
      };

      const overrides = productData(request.body);

      if (
        Object.hasOwn(request.body || {}, "title") &&
        !Object.hasOwn(request.body || {}, "productName")
      ) {
        overrides.productName = request.body.title;
      }

      const data = normalizeProductData({
        ...generatedData,
        ...overrides,
        designNumber: root.designNumber,
      });

      delete data.parentId;
      delete data.variantNumber;
      delete data.variantType;
      validateProductData(data, "Charm");

      const charm = await Charm.create({
        ...data,
        sourceProductId: source._id,
        sourceKind: source.parentId ? "variant" : "parent",
        sourceVariantNumber: source.variantNumber,
      });
      response.status(201).json({
        success: true,
        message: "Charm saved in the separate charms collection. Product was not changed.",
        charm: serializeProductWithMeta(charm),
      });
    } catch (error) {
      if (error?.code === 11000) return next(conflict("This charm SKU already exists."));
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| UPDATE PRODUCT
|--------------------------------------------------------------------------
*/

router.patch(
  "/:id",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const current =
        await Product.findById(
          request.params.id,
        );

      if (!current) {
        throw notFound(
          "Product not found.",
        );
      }

      let data =
        normalizeProductData(
          productData(
            request.body,
          ),
        );

      /*
      |--------------------------------------------------------------------------
      | Parent
      |--------------------------------------------------------------------------
      */

      if (!current.parentId) {
        data.designId =
          data.designId ??
          current.designId?.toString();

        await applyDesignReference(data);

        await ensureUniqueParentProduct(
          {
            productName:
              data.productName ??
              current.productName,

            designCode:
              data.designCode ??
              current.designCode,

            designId:
              data.designId ??
              current.designId,
          },
          current._id,
        );

        /*
        |--------------------------------------------------------------------------
        | Parent Design Number
        |--------------------------------------------------------------------------
        */

        const nextDesignNumber =
          data.designNumber ??
          current.designNumber;

        /*
        |--------------------------------------------------------------------------
        | Parent SKU
        |--------------------------------------------------------------------------
        */

        const nextSku =
          data.sku ??
          current.sku;

        /*
        |--------------------------------------------------------------------------
        | Check changed Design Number
        |--------------------------------------------------------------------------
        */

        if (
          nextDesignNumber !==
            current.designNumber
        ) {
          const designExists =
            await Product.exists({
              parentId: {
                $exists: false,
              },

              designNumber:
                nextDesignNumber,

              _id: {
                $ne:
                  current._id,
              },
            });

          if (designExists) {
            throw conflict(
              "This Design Number already exists in the database.",
            );
          }
        }

        /*
        |--------------------------------------------------------------------------
        | Check changed SKU
        |--------------------------------------------------------------------------
        */

        if (
          nextSku !==
          current.sku
        ) {
          const skuExists =
            await Product.exists({
              sku:
                String(
                  nextSku,
                )
                  .trim()
                  .toUpperCase(),

              _id: {
                $ne:
                  current._id,
              },
            });

          if (skuExists) {
            throw conflict(
              "This SKU already exists in the database.",
            );
          }
        }

        delete data.parentId;

        delete data.variantNumber;
      }

      /*
      |--------------------------------------------------------------------------
      | Variant
      |--------------------------------------------------------------------------
      */

      if (current.parentId) {
        data.parentId =
          current.parentId;

        data.variantNumber =
          data.variantNumber ??
          current.variantNumber ??
          2;

        /*
        |--------------------------------------------------------------------------
        | Always inherit parent's Design Number
        |--------------------------------------------------------------------------
        */

        const parent =
          await Product.findById(
            current.parentId,
          )
            .select(
              "designId designName designCode designNumber",
            )
            .lean();

        if (!parent) {
          throw notFound(
            "Parent product not found.",
          );
        }

        data.designNumber =
          parent.designNumber;

        data.designId =
          parent.designId;

        data.designName =
          parent.designName;

        data.designCode =
          parent.designCode;

        /*
        |--------------------------------------------------------------------------
        | SKU uniqueness
        |--------------------------------------------------------------------------
        */

        if (
          data.sku &&
          data.sku !==
            current.sku
        ) {
          const existing =
            await Product.exists({
              sku:
                String(
                  data.sku,
                )
                  .trim()
                  .toUpperCase(),

              _id: {
                $ne:
                  current._id,
              },
            });

          if (existing) {
            throw conflict(
              "This SKU already exists in the database.",
            );
          }
        }
      }

      const updated =
        await Product.findByIdAndUpdate(
          request.params.id,
          data,
          {
            new: true,
            runValidators: true,
          },
        );

      if (!updated) {
        throw notFound(
          "Product not found.",
        );
      }

      response.json({
        success: true,

        message:
          "Product updated successfully.",

        product:
          serializeProductWithMeta(
            updated,
          ),
      });
    } catch (error) {
      if (
        error?.code ===
        11000
      ) {
        const field =
          Object.keys(
            error.keyPattern ||
              error.keyValue ||
              {},
          )[0];

        if (
          field ===
          "designNumber"
        ) {
          return next(
            conflict(
              "This Design Number already exists in the database.",
            ),
          );
        }

        if (
          field ===
          "sku"
        ) {
          return next(
            conflict(
              "This SKU already exists in the database.",
            ),
          );
        }
      }

      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| STOCK SET
|--------------------------------------------------------------------------
*/

router.patch(
  "/:id/stock",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const inventory =
        Number(
          request.body?.inventory,
        );

      if (
        !Number.isFinite(
          inventory,
        ) ||
        inventory < 0
      ) {
        throw badRequest(
          "Inventory must be a non-negative number.",
        );
      }

      const product =
        await Product.findByIdAndUpdate(
          request.params.id,
          {
            $set: {
              inventory,
            },
          },
          {
            new: true,
            runValidators: true,
          },
        );

      if (!product) {
        throw notFound(
          "Product not found.",
        );
      }

      response.json({
        success: true,

        message:
          "Stock updated successfully.",

        product:
          serializeProductWithMeta(
            product,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| STOCK ADD
|--------------------------------------------------------------------------
*/

router.patch(
  "/:id/stock/add",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const quantity =
        Number(
          request.body?.quantity,
        );

      if (
        !Number.isFinite(
          quantity,
        ) ||
        quantity <= 0
      ) {
        throw badRequest(
          "Quantity must be greater than 0.",
        );
      }

      const product =
        await Product.findByIdAndUpdate(
          request.params.id,
          {
            $inc: {
              inventory:
                quantity,
            },
          },
          {
            new: true,
            runValidators: true,
          },
        );

      if (!product) {
        throw notFound(
          "Product not found.",
        );
      }

      response.json({
        success: true,

        message:
          "Stock added successfully.",

        product:
          serializeProductWithMeta(
            product,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| STOCK REMOVE
|--------------------------------------------------------------------------
*/

router.patch(
  "/:id/stock/remove",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const quantity =
        Number(
          request.body?.quantity,
        );

      if (
        !Number.isFinite(
          quantity,
        ) ||
        quantity <= 0
      ) {
        throw badRequest(
          "Quantity must be greater than 0.",
        );
      }

      const result =
        await Product.findOneAndUpdate(
          {
            _id:
              request.params.id,

            inventory: {
              $gte:
                quantity,
            },
          },
          {
            $inc: {
              inventory:
                -quantity,
            },
          },
          {
            new: true,
            runValidators: true,
          },
        );

      if (!result) {
        const exists =
          await Product.exists({
            _id:
              request.params.id,
          });

        if (!exists) {
          throw notFound(
            "Product not found.",
          );
        }

        throw conflict(
          "Cannot remove more stock than the current inventory.",
        );
      }

      response.json({
        success: true,

        message:
          "Stock removed successfully.",

        product:
          serializeProductWithMeta(
            result,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| UPDATE IMAGES
|--------------------------------------------------------------------------
*/

router.patch(
  "/:id/images",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const update = {};

      for (
        const field of [
          "image1",
          "image2",
          "image3",
          "image4",
        ]
      ) {
        if (
          Object.hasOwn(
            request.body || {},
            field,
          )
        ) {
          update[field] =
            String(
              request.body[field] ??
                "",
            ).trim();
        }
      }

      const product =
        await Product.findByIdAndUpdate(
          request.params.id,
          {
            $set: update,
          },
          {
            new: true,
            runValidators: true,
          },
        );

      if (!product) {
        throw notFound(
          "Product not found.",
        );
      }

      response.json({
        success: true,

        message:
          "Product images updated successfully.",

        product:
          serializeProductWithMeta(
            product,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| SEARCH
|--------------------------------------------------------------------------
*/

router.get(
  "/search",
  async (
    request,
    response,
    next,
  ) => {
    try {
      const query =
        String(
          request.query.q ||
            "",
        ).trim();

      if (!query) {
        throw badRequest(
          "Search query is required.",
        );
      }

      const regex =
        new RegExp(
          escapeRegex(query),
          "i",
        );

      const products =
        await Product.find({
          $or: [
            {
              productName:
                regex,
            },
            {
              brand:
                regex,
            },
            {
              category:
                regex,
            },
            {
              designName:
                regex,
            },
            {
              designCode:
                regex,
            },
            {
              designNumber:
                regex,
            },
            {
              sku:
                regex,
            },
            {
              groupId:
                regex,
            },
            {
              "models.model":
                regex,
            },
          ],
        })
          .sort({
            createdAt: -1,
          })
          .limit(100)
          .lean();

      response.json({
        success: true,

        count:
          products.length,

        products:
          products.map(
            serializeProductWithMeta,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| GROUP
|--------------------------------------------------------------------------
*/

router.get(
  "/group/:groupId",
  async (
    request,
    response,
    next,
  ) => {
    try {
      const groupId =
        String(
          request.params.groupId ||
            "",
        ).trim();

      if (!groupId) {
        throw badRequest(
          "Group ID is required.",
        );
      }

      const products =
        await Product.find({
          groupId,
        })
          .sort({
            variantNumber: 1,
            createdAt: 1,
          })
          .lean();

      response.json({
        success: true,

        groupId,

        count:
          products.length,

        products:
          products.map(
            serializeProductWithMeta,
          ),
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| LIST PRODUCTS
|--------------------------------------------------------------------------
*/

router.get(
  "/",
  async (
    request,
    response,
    next,
  ) => {
    try {
      const page =
        Math.max(
          Number(
            request.query.page,
          ) || 1,
          1,
        );

      const limit =
        Math.min(
          Math.max(
            Number(
              request.query.limit,
            ) || 50,
            1,
          ),
          500,
        );

      const skip =
        (page - 1) * limit;

      const filter = {};

      /*
      |--------------------------------------------------------------------------
      | Search
      |--------------------------------------------------------------------------
      */

      const search =
        String(
          request.query.search ||
            "",
        ).trim();

      if (search) {
        const regex =
          new RegExp(
            escapeRegex(search),
            "i",
          );

        filter.$or = [
          {
            productName:
              regex,
          },
          {
            brand:
              regex,
          },
          {
            category:
              regex,
          },
          {
            designName:
              regex,
          },
          {
            designCode:
              regex,
          },
          {
            designNumber:
              regex,
          },
          {
            sku:
              regex,
          },
          {
            groupId:
              regex,
          },
          {
            "models.model":
              regex,
          },
        ];
      }

      /*
      |--------------------------------------------------------------------------
      | Category
      |--------------------------------------------------------------------------
      */

      if (
        request.query.category &&
        request.query.category !==
          "all"
      ) {
        filter.category =
          request.query.category;
      }

      /*
      |--------------------------------------------------------------------------
      | Brand
      |--------------------------------------------------------------------------
      */

      if (
        request.query.brand &&
        request.query.brand !==
          "all"
      ) {
        filter.brand =
          request.query.brand;
      }

      /*
      |--------------------------------------------------------------------------
      | Parent / Variant
      |--------------------------------------------------------------------------
      */

      if (
        request.query.kind ===
        "parent"
      ) {
        filter.parentId = {
          $exists: false,
        };
      }

      if (
        request.query.kind ===
        "variant"
      ) {
        filter.parentId = {
          $exists: true,
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Stock
      |--------------------------------------------------------------------------
      */

      if (
        request.query.stock ===
        "in-stock"
      ) {
        filter.inventory = {
          $gt: 20,
        };
      }

      if (
        request.query.stock ===
        "low-stock"
      ) {
        filter.inventory = {
          $gt: 0,
          $lte: 20,
        };
      }

      if (
        request.query.stock ===
        "out-of-stock"
      ) {
        filter.inventory = {
          $lte: 0,
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Sort
      |--------------------------------------------------------------------------
      */

      let sort = {
        createdAt: -1,
      };

      switch (
        request.query.sort
      ) {
        case "oldest":
          sort = {
            createdAt: 1,
          };
          break;

        case "name":
          sort = {
            productName: 1,
          };
          break;

        case "price-low":
          sort = {
            price: 1,
          };
          break;

        case "price-high":
          sort = {
            price: -1,
          };
          break;

        case "stock-low":
          sort = {
            inventory: 1,
          };
          break;

        case "stock-high":
          sort = {
            inventory: -1,
          };
          break;

        default:
          break;
      }

      /*
      |--------------------------------------------------------------------------
      | Fetch
      |--------------------------------------------------------------------------
      */

      const [
        rawProducts,
        total,
      ] =
        await Promise.all([
          Product.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),

          Product.countDocuments(
            filter,
          ),
        ]);

      /*
      |--------------------------------------------------------------------------
      | Fetch variants for parents
      |--------------------------------------------------------------------------
      */

      const parentIds =
        rawProducts
          .filter(
            (product) =>
              !product.parentId,
          )
          .map(
            (product) =>
              product._id,
          );

      const variants =
        parentIds.length
          ? await Product.find({
              parentId: {
                $in: parentIds,
              },
            })
              .sort({
                variantNumber: 1,
              })
              .lean()
          : [];

      /*
      |--------------------------------------------------------------------------
      | Charm counts by exact source product
      |
      | Charm records live in their own collection. Counting by sourceProductId
      | lets the catalog show which parent or variant generated each charm
      | without modifying Product documents or issuing one query per row.
      |--------------------------------------------------------------------------
      */

      const catalogProductIds = [
        ...rawProducts.map(
          (product) =>
            product._id,
        ),
        ...variants.map(
          (variant) =>
            variant._id,
        ),
      ];

      const charmCountRows =
        catalogProductIds.length
          ? await Charm.aggregate([
              {
                $match: {
                  sourceProductId: {
                    $in: catalogProductIds,
                  },
                },
              },
              {
                $group: {
                  _id: "$sourceProductId",
                  count: {
                    $sum: 1,
                  },
                },
              },
            ])
          : [];

      const charmCountBySource =
        new Map(
          charmCountRows.map(
            (item) => [
              item._id.toString(),
              Number(item.count || 0),
            ],
          ),
        );

      /*
      |--------------------------------------------------------------------------
      | Group variants
      |--------------------------------------------------------------------------
      */

      const variantsByParent =
        new Map();

      for (
        const variant of
          variants
      ) {
        const key =
          variant.parentId.toString();

        if (
          !variantsByParent.has(
            key,
          )
        ) {
          variantsByParent.set(
            key,
            [],
          );
        }

        const charmCount =
          charmCountBySource.get(
            variant._id.toString(),
          ) || 0;

        variantsByParent
          .get(key)
          .push({
            ...serializeProductWithMeta(
              variant,
            ),
            charmCount,
            relatedCharmCount:
              charmCount,
          });
      }

      const products =
        rawProducts.map(
          (product) => {
            const productId =
              product._id.toString();

            const productVariants =
              variantsByParent.get(
                productId,
              ) || [];

            const charmCount =
              charmCountBySource.get(
                productId,
              ) || 0;

            const relatedCharmCount =
              charmCount +
              productVariants.reduce(
                (total, variant) =>
                  total +
                  Number(
                    variant.charmCount || 0,
                  ),
                0,
              );

            return {
              ...serializeProductWithMeta(
                product,
              ),
              charmCount,
              relatedCharmCount,
              variants:
                productVariants,
            };
          },
        );

      response.json({
        success: true,

        products,

        pagination: {
          page,
          limit,
          total,

          totalPages:
            Math.ceil(
              total / limit,
            ),

          hasNextPage:
            page * limit <
            total,

          hasPreviousPage:
            page > 1,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| SINGLE PRODUCT
|
| This MUST stay after the named routes above.
|--------------------------------------------------------------------------
*/

router.get(
  "/:id",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const product =
        await Product.findById(
          request.params.id,
        ).lean();

      if (!product) {
        throw notFound(
          "Product not found.",
        );
      }

      const rootId =
        product.parentId ||
        product._id;

      const variants =
        await Product.find({
          parentId:
            rootId,
        })
          .sort({
            variantNumber: 1,
          })
          .lean();

      let parent = null;

      if (product.parentId) {
        const parentProduct =
          await Product.findById(
            product.parentId,
          ).lean();

        if (parentProduct) {
          parent =
            serializeProductWithMeta(
              parentProduct,
            );
        }
      }

      const totalInventory =
        Number(
          product.inventory ||
            0,
        ) +
        variants.reduce(
          (
            total,
            variant,
          ) =>
            total +
            Number(
              variant.inventory ||
                0,
            ),
          0,
        );

      response.json({
        success: true,

        product:
          serializeProductWithMeta(
            product,
          ),

        parent,

        variants:
          variants.map(
            serializeProductWithMeta,
          ),

        variantCount:
          variants.length,

        totalInventory,
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
|--------------------------------------------------------------------------
| DELETE
|--------------------------------------------------------------------------
*/

router.delete(
  "/:id",
  async (
    request,
    response,
    next,
  ) => {
    if (
      !validId(
        request.params.id,
      )
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Invalid product ID.",
        });
    }

    try {
      const product =
        await Product.findById(
          request.params.id,
        ).lean();

      if (!product) {
        throw notFound(
          "Product not found.",
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Variant = delete only variant
      |--------------------------------------------------------------------------
      */

      if (product.parentId) {
        const result =
          await Product.deleteOne({
            _id:
              request.params.id,
          });

        return response.json({
          success: true,

          message:
            "Variant deleted successfully.",

          deletedCount:
            result.deletedCount,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Parent = delete parent + variants
      |--------------------------------------------------------------------------
      */

      const result =
        await Product.deleteMany({
          $or: [
            {
              _id:
                request.params.id,
            },

            {
              parentId:
                request.params.id,
            },
          ],
        });

      response.json({
        success: true,

        message:
          "Product and variants deleted successfully.",

        deletedCount:
          result.deletedCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
