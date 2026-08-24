# Listing Tool API

Standalone Node.js, Express, and MongoDB API for the listing tool.

## Run locally

1. Copy `.env.example` to `.env` and replace `<password>` with the password for your MongoDB Atlas database user. URL-encode special characters in the password.
2. Install and start the API:

```bash
npm install
npm run dev
```

The API starts at `http://localhost:5000`. Check it at `GET /api/health`.

## Deploy to Render

Create a **Web Service** from this repository and configure:

| Render setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm start` |

Add these Render environment variables:

| Key | Value |
| --- | --- |
| `MONGODB_URI` | Your complete MongoDB Atlas connection string, with the real password |
| `CLIENT_ORIGIN` | Your Vercel frontend URL, for example `https://your-app.vercel.app` |

Render provides `PORT` automatically. Do not add a real `.env` file to Git.

After deployment, use `https://your-render-service.onrender.com/api` as the API base URL. Add that value to Vercel as `NEXT_PUBLIC_API_URL` when connecting the frontend.

## Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API and database status |
| `GET` | `/api/products` | List products and variants |
| `POST` | `/api/products` | Create a product or variant |
| `POST` | `/api/products/:id/with-charm` | Copy a product into the separate charms collection |
| `GET` | `/api/products/:id/charms` | List all charms sharing the product's Design Number |
| `DELETE` | `/api/products/:id/charms/:charmId` | Delete a related charm without changing the product |
| `PATCH` | `/api/products/:id/charms/:charmId` | Update editable charm fields without changing the product |
| `GET` | `/api/charms?designNumber=317` | List separately stored charms for a design number |
| `POST` | `/api/charms` | Create a charm directly in the separate charms collection |
| `PATCH` / `DELETE` | `/api/charms/:id` | Update or delete a charm without touching products |
| `GET` | `/api/products/:id` | Get one product |
| `PATCH` | `/api/products/:id` | Update a product or variant |
| `DELETE` | `/api/products/:id` | Delete a product; deleting a parent also removes its variants |

## Create a with-charms product

Send a `POST` request to `/api/products/:id/with-charm`, where `:id` is the
original product ID. The new charm copies all fields (images, price, phone
models, inventory details, and so on), is saved in the separate MongoDB
`charms` collection, and always uses the original product's Design Number.
The original product is not updated and no Product variant is created.

The charm page displays the parent and all of its variants. A charm can be
generated from any individual row or from all missing rows at once. Generated
drafts and stored charms use a horizontally scrollable editable table. The
shared Design Number stays locked so every charm remains connected to the
correct design; saving an edited charm never updates its source product.

You may omit the body to use generated “With Charms” values, or send exact
replacement values from the form. `title` is accepted as an alias for
`productName`.

```json
{
  "designName": "Aesthetic Pastel Floral With Charms",
  "sku": "MC-AP-IP13-UVV-APF-WL-TRNSPT-WITH CHRM-117.1.V1",
  "title": "Premium Crystal Clear Silicon Back Cover with Elegant Aesthetic Pastel Floral With Charms Print"
}
```
