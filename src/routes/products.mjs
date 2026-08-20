import express from "express";
import mongoose from "mongoose";

import Product from "../models/Product.mjs";

const router = express.Router();

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

  return normalized;
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

  if (data.designCode?.trim()) {
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

      const existing =
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
          !existing,
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
          },

          lowStock,

          outOfStock,

          healthyStock:
            Math.max(
              totalRecords -
                lowStock -
                outOfStock,
              0,
            ),
        },

        categories:
          categories.map(
            (item) => ({
              name:
                item._id,

              count:
                item.count,

              stock:
                item.stock,
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
            }),
          ),

        recentProducts:
          recentProducts.map(
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
              "designNumber",
            )
            .lean();

        if (!parent) {
          throw notFound(
            "Parent product not found.",
          );
        }

        data.designNumber =
          parent.designNumber;

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
        await ensureUniqueParentProduct(
          {
            productName:
              data.productName ??
              current.productName,

            designCode:
              data.designCode ??
              current.designCode,
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
              "designNumber",
            )
            .lean();

        if (!parent) {
          throw notFound(
            "Parent product not found.",
          );
        }

        data.designNumber =
          parent.designNumber;

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

        variantsByParent
          .get(key)
          .push(
            serializeProductWithMeta(
              variant,
            ),
          );
      }

      const products =
        rawProducts.map(
          (product) => ({
            ...serializeProductWithMeta(
              product,
            ),

            variants:
              variantsByParent.get(
                product._id.toString(),
              ) || [],
          }),
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