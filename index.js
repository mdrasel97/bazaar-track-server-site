const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceAccount = require("./bazaar-track-admin-key.json");
const OpenAI = require("openai");
const port = process.env.PORT || 5000;

// ENV config
dotenv.config();

// App init
const app = express();
app.use(cors());
app.use(express.json());

// ai api
const clients = {
  gemini: new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/",
  }),
};

// model map
const modelMap = {
  gemini: "gemini-1.5-flash",
};

// stripe payment
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// firebase admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.MDB_USER}:${process.env.MDB_PASS}@cluster0.eyqagy8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  const db = client.db("bazaar-track");
  const usersCollection = db.collection("users");
  const productsCollection = db.collection("products");
  const advertisementsCollection = db.collection("advertisements");
  const paymentsCollection = db.collection("payments");
  const watchListCollection = db.collection("watchList");
  const reviewsCollection = db.collection("reviews");
  // const cartCollection = db.collection("cartCheckOut");

  // custom middle ware
  const verifyFBToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    // console.log(authHeader);
    if (!authHeader) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // verify the token
    try {
      const decodedUser = await admin.auth().verifyIdToken(token);
      req.decodedUser = decodedUser;
      next();
    } catch (error) {
      return res.status(403).json({ message: "forbidden access" });
    }
  };

  const verifyAdmin = async (req, res, next) => {
    const email = req.decodedUser?.email;

    if (!email) {
      return res.status(401).send({ message: "Unauthorized: Email missing" });
    }

    try {
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admins only" });
      }

      next(); // Allow access
    } catch (error) {
      console.error("❌ Admin verification failed:", err.message);
      res.status(500).json({ message: "Internal Server Error" });
    }
  };

  const verifyVendor = async (req, res, next) => {
    const email = req.decodedUser?.email;

    if (!email) {
      return res.status(401).send({ message: "Unauthorized: Email not found" });
    }

    try {
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "vendor") {
        return res
          .status(403)
          .json({ message: "Forbidden: Vendor access only" });
      }

      next(); // Access granted
    } catch (err) {
      console.error("Vendor verification failed:", err.message);
      res.status(500).json({ message: "Internal server error" });
    }
  };

  // ai related api

  app.post("/api/chat", async (req, res) => {
    const { model, messages } = req.body;

    if (!model || !clients[model]) {
      return res.status(400).send({ error: "Invalid or unsupported model." });
    }

    try {
      const client = clients[model];
      const response = await client.chat.completions.create({
        model: modelMap[model],
        messages: messages,
      });

      return res.send(response);
    } catch (error) {
      console.error(`${model.toUpperCase()} API Error:`, error.message);
      return res.status(500).send({ error: "AI response failed." });
    }
  });

  //   users related api
  app.get("/users", async (req, res) => {
    try {
      const users = await usersCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json(users);
    } catch (err) {
      console.error("❌ Failed to fetch users:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
  // GET /users/search?email=someone@example.com
  app.get("/users/search", verifyFBToken, verifyAdmin, async (req, res) => {
    const { email, name } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const query = {
      $or: [],
    };

    if (email) {
      query.$or.push({ email: { $regex: email, $options: "i" } });
    }

    if (name) {
      query.$or.push({ name: { $regex: name, $options: "i" } });
    }

    try {
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/users/role", async (req, res) => {
    const email = req.query.email;
    if (!email) return res.status(400).json({ role: "guest" });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ role: "guest" });

    res.json({ role: user.role });
  });

  app.get("/users/role/:email", async (req, res) => {
    try {
      const email = req.params.email;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await usersCollection.findOne(
        { email },
        { projection: { _id: 0, role: 1 } }
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({ role: user.role });
    } catch (error) {
      console.error("Error fetching role:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/users/:id/role", async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!["admin", "vendor"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    res.send(result);
  });

  app.post("/users", async (req, res) => {
    console.log("REQ BODY:", req.body);
    try {
      const { name, email, photoURL, provider } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Check if user already exists
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }

      const newUser = {
        name,
        email,
        photoURL,
        provider: provider || "firebase",
        role: "user",
        createdAt: new Date(),
        lastLogin: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      res.send({ ...result, inserted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // payment related api
  app.post("/create-payment-intent", verifyFBToken, async (req, res) => {
    const amountInCents = req.body.amountInCents;
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents, // Amount in cents (e.g., $10.00)
        currency: "usd",
        payment_method_types: ["card"],
      });

      // Correct JSON response
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
      console.error("Payment Intent Error:", error);
      res.status(500).json({
        message: "Failed to create payment intent",
        error: error.message,
      });
    }
  });

  app.get("/orders", verifyFBToken, verifyAdmin, async (req, res) => {
    try {
      const orders = await paymentsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json(orders);
    } catch (err) {
      console.error("❌ Failed to fetch all orders:", err.message);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/my-orders", verifyFBToken, async (req, res) => {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    try {
      // 1️⃣ Find all payments by this user with status "paid"
      const payments = await paymentsCollection
        .find({ userEmail: email, status: "paid" })
        .toArray();

      // 2️⃣ Extract product IDs from payments
      const productIds = payments.map(
        (payment) => new ObjectId(payment.productId)
      );

      // 3️⃣ Find products from productsCollection
      const orderedProducts = await productsCollection
        .find({ _id: { $in: productIds } })
        .toArray();

      res.status(200).json(orderedProducts);
    } catch (err) {
      console.error("❌ Failed to fetch my orders:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/payments", async (req, res) => {
    try {
      const paymentInfo = req.body;
      const result = await paymentsCollection.insertOne(paymentInfo);
      res.status(200).json({ insertedId: result.insertedId });
    } catch (error) {
      console.error("Payment Save Error:", error);
      res.status(500).json({ error: "Failed to save payment" });
    }
  });

  // cart data api
  // app.post("/cartCheckOut", async (req, res) => {
  //   const order = req.body;
  //   if (!order || !order.cartItems || !order.cartItems.length) {
  //     return res.status(400).json({ message: "Invalid order data" });
  //   }

  //   try {
  //     const result = await orderCollection.insertOne(order);
  //     res
  //       .status(201)
  //       .json({ message: "Order saved", insertedId: result.insertedId });
  //   } catch (err) {
  //     res
  //       .status(500)
  //       .json({ message: "Failed to save order", error: err.message });
  //   }
  // });

  // advertisement related api
  // app.get("/advertisements", async (req, res) => {
  //   const { vendorEmail } = req.query;
  //   const ads = await advertisementsCollection
  //     .find({ vendorEmail })
  //     .sort({ createdAt: -1 })
  //     .toArray();
  //   res.send(ads);
  // });

  app.get("/advertisements", verifyFBToken, verifyVendor, async (req, res) => {
    try {
      const { vendorEmail } = req.query;

      const filter = vendorEmail ? { vendorEmail } : {};

      const ads = await advertisementsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(ads);
    } catch (error) {
      console.error("Error fetching advertisements:", error);
      res.status(500).send({ message: "Failed to fetch advertisements" });
    }
  });

  app.get(
    "/admin/advertisements",
    verifyFBToken,
    verifyAdmin,
    async (req, res) => {
      const ads = await advertisementsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.send(ads);
    }
  );

  app.get("/advertisements/highlights", async (req, res) => {
    try {
      const highlights = await advertisementsCollection
        .find({ status: "approved" }) // শুধু approved ad দেখাবে
        .sort({ createdAt: -1 }) // latest ads first
        .limit(10)
        .toArray();

      res.status(200).json(highlights);
    } catch (err) {
      console.error("❌ Failed to fetch ad highlights:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/advertisements/:id", async (req, res) => {
    const id = req.params.id;
    const { title, description, image } = req.body;

    if (!title || !description || !image) {
      return res.status(400).json({ message: "All fields are required" });
    }

    try {
      const result = await advertisementsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            title,
            description,
            image,
          },
        }
      );

      res.status(200).json(result);
    } catch (err) {
      console.error("❌ Failed to update advertisement:", err.message);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // PATCH
  app.patch("/admin/advertisements/:id", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const result = await advertisementsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    res.send(result); // result.modifiedCount frontend e pabe
  });

  app.post("/advertisements", async (req, res) => {
    const ad = req.body;
    const result = await advertisementsCollection.insertOne(ad);
    res.send(result);
  });

  app.delete("/advertisements/:id", async (req, res) => {
    const { id } = req.params;
    const result = await advertisementsCollection.deleteOne({
      _id: new ObjectId(id),
    });
    res.send(result);
  });

  // manage watch list related api
  app.get("/watchList", async (req, res) => {
    const { email } = req.query;
    console.log("email nai", email);

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    try {
      const watchList = await watchListCollection.find({ email }).toArray();

      res.status(200).json(watchList);
    } catch (error) {
      console.error("❌ Error fetching watchList:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post("/watchList", async (req, res) => {
    const watchItem = req.body;

    try {
      const result = await watchListCollection.insertOne(watchItem);
      res.status(201).json(result);
    } catch (err) {
      console.error("❌ Failed to add to watchlist:", err.message);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.delete("/watchList/:id", async (req, res) => {
    const id = req.params.id;

    try {
      const result = await watchListCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount > 0) {
        res.status(200).json({
          message: "Successfully removed from",
          deletedCount: result.deletedCount,
        });
      } else {
        res.status(404).json({
          message: "Item not found in watchList",
          deletedCount: 0,
        });
      }
    } catch (err) {
      console.error("❌ Failed to delete watchList item:", err.message);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // products related api
  app.get("/products", async (req, res) => {
    try {
      const products = await productsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json(products);
    } catch (err) {
      console.error("❌ Failed to fetch products:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/products/status", async (req, res) => {
    try {
      const allProducts = await productsCollection
        .find({}, { projection: { status: 1 } })
        .toArray();

      const statusCount = {
        approved: 0,
        pending: 0,

        // deliverable: 0,
        // undeliverable: 0,
        // risky: 0,
        // unknown: 0,
        // duplicate: 0,
      };

      allProducts.forEach((product) => {
        const status = product.status?.toLowerCase();
        if (status && statusCount.hasOwnProperty(status)) {
          statusCount[status]++;
        }
      });

      res.status(200).json(statusCount);
    } catch (error) {
      console.error("Failed to get product status count:", error);
      res.status(500).json({ message: "Server Error" });
    }
  });

  app.get(
    "/products/pagination",
    verifyFBToken,
    verifyAdmin,
    async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1; // current page
        const limit = parseInt(req.query.limit) || 5; // item per page
        const skip = (page - 1) * limit;

        const total = await productsCollection.countDocuments(); // total number of products

        const products = await productsCollection
          .find({})
          .sort({ createdAt: -1 }) // optional sorting
          .skip(skip)
          .limit(limit)
          .toArray();

        res.status(200).json({
          total,
          page,
          totalPages: Math.ceil(total / limit),
          products,
        });
      } catch (err) {
        console.error("❌ Failed to fetch products:", err.message);
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get("/products/approved/trends", async (req, res) => {
    try {
      const products = await productsCollection
        .find({ status: "approved" }) // 🔥 Filter only approved products
        .sort({ createdAt: -1 })
        .toArray();

      res.status(200).json(products);
    } catch (err) {
      console.error("❌ Failed to fetch approved products:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ✅ GET /products/approved

  app.get("/products/approved", async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = 20;
      const skip = (page - 1) * limit;

      const sortKey = req.query.sort || "createdAt";
      const order = req.query.order === "asc" ? 1 : -1;

      const filter = { status: "approved" };

      // Optional: date filter
      if (req.query.date) {
        filter.date = req.query.date; // must be "YYYY-MM-DD"
      }

      const total = await productsCollection.countDocuments(filter);
      const products = await productsCollection
        .find(filter)
        .sort({ [sortKey]: order }) // ✅ Sort by key & order
        .skip(skip) // ✅ Pagination start
        .limit(limit) // ✅ Page size
        .toArray();

      res.status(200).json({
        total,
        page,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
        products,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/products/home", async (req, res) => {
    try {
      const products = await productsCollection
        .find({ status: "approved" })
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray();
      // console.log("Fetched products for home:", products);
      res.status(200).json(products);
    } catch (err) {
      console.error("Failed to fetch homepage products:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // get by email for my products
  app.get(
    "/my-products/:email",
    verifyFBToken,
    verifyVendor,
    async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        const products = await productsCollection
          .find({ vendorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(products);
      } catch (err) {
        console.error("❌ Failed to fetch vendor products:", err.message);
        res.status(500).json({ error: err.message });
      }
    }
  );

  app.get("/products/:id", async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    try {
      const product = await productsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.status(200).json(product);
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  });

  // app.get("/products/home", async (req, res) => {
  //   try {
  //     const products = await productsCollection
  //       .find({})
  //       .sort({ createdAt: -1 })
  //       .limit(6)
  //       .toArray();

  //     res.status(200).json(products);
  //   } catch (err) {
  //     console.error("❌ Failed to fetch home products:", err.message);
  //     res.status(500).json({ error: err.message });
  //   }
  // });

  // app.get("/products", async (req, res) => {
  //   const { sort, date } = req.query;

  //   const filter = {};
  //   if (date) filter.date = date;

  //   let sortQuery = {};
  //   if (sort === "price-low") sortQuery.pricePerUnit = 1;
  //   if (sort === "price-high") sortQuery.pricePerUnit = -1;
  //   if (sort === "date-latest") sortQuery.date = -1;
  //   if (sort === "date-oldest") sortQuery.date = 1;

  //   try {
  //     const products = await productsCollection
  //       .find(filter)
  //       .sort(sortQuery)
  //       .toArray();
  //     res.json(products);
  //   } catch (err) {
  //     res.status(500).json({ error: err.message });
  //   }
  // });

  // PATCH approve
  app.patch("/admin/products/:id/approve", async (req, res) => {
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "approved" } }
    );
    res.send(result);
  });

  // PATCH reject
  app.patch("/admin/products/:id/reject", async (req, res) => {
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "rejected", feedback: req.body.feedback } }
    );
    res.send(result);
  });

  app.post("/products", async (req, res) => {
    try {
      const {
        vendorEmail,
        vendorName,
        marketName,
        date,
        marketDescription,
        itemName,
        status = "pending",
        productImage,
        category,
        pricePerUnit,
        prices,
        itemDescription,
      } = req.body;

      // Required field validation
      if (
        !vendorEmail ||
        !marketName ||
        !itemName ||
        !pricePerUnit ||
        !prices
      ) {
        return res.status(400).json({ message: "Missing required fields." });
      }

      const newProduct = {
        vendorEmail,
        vendorName: vendorName || null,
        marketName,
        date: date || new Date().toISOString().split("T")[0],
        marketDescription,
        itemName,
        status,
        productImage,
        pricePerUnit,
        category,
        prices,
        itemDescription,
        createdAt: new Date(),
      };

      const result = await productsCollection.insertOne(newProduct);
      res.status(201).json({
        insertedId: result.insertedId,
        message: "Product added successfully.",
      });
    } catch (err) {
      console.error("❌ Error posting product:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // update Product
  app.put("/products/:id", async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.modifiedCount === 1) {
        res.status(200).json({ message: "Product updated successfully." });
      } else {
        res.status(404).json({ message: "No product found to update." });
      }
    } catch (error) {
      console.error("❌ Error updating product:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE product by ID
  app.delete("/products/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // if (!ObjectId.isValid(id)) {
      //   return res.status(400).json({ message: "Invalid Parcel ID" });
      // }

      const result = await productsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    } catch (error) {
      console.error("Delete Error:", error);
      res
        .status(500)
        .json({ message: "Error deleting parcel", error: error.message });
    }
  });

  // reviews related api
  app.post("/reviews", async (req, res) => {
    try {
      const review = req.body;
      const result = await reviewsCollection.insertOne(review);
      res.send(result);
    } catch (err) {
      res.status(500).send({ error: "Failed to post review" });
    }
  });

  app.get("/reviews/:productId", async (req, res) => {
    const productId = req.params.productId;
    const result = await reviewsCollection
      .find({ productId })
      .sort({ date: -1 })
      .toArray();
    res.send(result);
  });

  try {
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("bazaar track server running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
