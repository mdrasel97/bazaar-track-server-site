const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

// ENV config
dotenv.config();

// App init
const app = express();
app.use(cors());
app.use(express.json());

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

  // advertisement related api
  app.get("/advertisements", async (req, res) => {
    const { vendorEmail } = req.query;
    const ads = await advertisementsCollection
      .find({ vendorEmail })
      .sort({ createdAt: -1 })
      .toArray();
    res.send(ads);
  });
  app.post("/advertisements", async (req, res) => {
    const ad = req.body;
    const result = await advertisementsCollection.insertOne(ad);
    res.send(result);
  });

  app.get("/admin/advertisements", async (req, res) => {
    const ads = await advertisementsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();
    res.send(ads);
  });

  // PATCH
  app.patch("/advertisements/:id", async (req, res) => {
    const { id } = req.params;
    const updateDoc = {
      $set: {
        title: req.body.title,
        description: req.body.description,
        image: req.body.image,
      },
    };
    const result = await advertisementsCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );
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
  app.get("/my-products/:email", async (req, res) => {
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
