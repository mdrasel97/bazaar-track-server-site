const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const serviceAccount = require("./bazaar-track-admin-key.json");
const port = process.env.PORT || 5000;

// ENV config
dotenv.config();

// App init
const app = express();
app.use(cors());
app.use(express.json());

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
      const user = await usersCollection.findOne;

      if (!user || user.role !== "vendor") {
        return res
          .status(403)
          .json({ message: "Forbidden: Vendor access only" });
      }
      next(); // Allow access to vendor-only route
    } catch (err) {
      console.error("Vendor verification failed:", err.message);
      res.status(500).json({ message: "Internal server error" });
    }
  };

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
  app.get("/users/search", async (req, res) => {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    try {
      const users = await usersCollection
        .find({ email: { $regex: email, $options: "i" } })
        .toArray();

      res.send(users);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
  // app.get("/users/search", async (req, res) => {
  //   const email = req.query.email;
  //   if (!email) return res.status(400).send("Email required");

  //   const user = await usersCollection.findOne({ email });
  //   if (!user) return res.status(404).send("User not found");

  //   res.send(user);
  // });

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
  app.post("/create-payment-intent", async (req, res) => {
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

  app.get("/my-orders", async (req, res) => {
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
  app.get("/advertisements", async (req, res) => {
    const { vendorEmail } = req.query;
    const ads = await advertisementsCollection
      .find({ vendorEmail })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(ads);
  });

  app.get("/admin/advertisements", async (req, res) => {
    const ads = await advertisementsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.send(ads);
  });

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

  app.get("/products/approved", async (req, res) => {
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
  app.get("/my-products/:email", verifyFBToken, async (req, res) => {
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
  });

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
