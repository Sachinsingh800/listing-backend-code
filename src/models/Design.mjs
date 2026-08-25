import mongoose from "mongoose";

const designSchema = new mongoose.Schema(
  {
    designName: {
      type: String,
      required: true,
      trim: true,
    },

    designCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    category: {
      type: String,
      default: "",
      trim: true,
    },

    theme: {
      type: String,
      default: "",
      trim: true,
    },

    productType: {
      type: String,
      default: "",
      trim: true,
    },

    imageUrl: {
      type: String,
      default: "",
      trim: true,
    },

    thumbnailUrl: {
      type: String,
      default: "",
      trim: true,
    },

    imageFileId: {
      type: String,
      default: "",
      trim: true,
    },

    imageFilePath: {
      type: String,
      default: "",
      trim: true,
    },

    imageFileName: {
      type: String,
      default: "",
      trim: true,
    },

    imageMimeType: {
      type: String,
      default: "",
      trim: true,
    },

    source: {
      type: String,
      enum: ["ai", "legacy", "manual"],
      default: "manual",
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

designSchema.index(
  { designCode: 1 },
  {
    unique: true,
    name: "unique_design_code",
    collation: {
      locale: "en",
      strength: 2,
    },
  },
);

designSchema.index(
  { designName: 1 },
  {
    unique: true,
    name: "unique_design_name",
    collation: {
      locale: "en",
      strength: 2,
    },
  },
);
designSchema.index({ createdAt: -1 });

const Design =
  mongoose.models.Design ||
  mongoose.model(
    "Design",
    designSchema,
  );

export default Design;
