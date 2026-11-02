import express from 'express';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
const app = express()

app.use(express.json());
app.use(cors({
    origin: ['http://localhost:3000'],
    allowedHeaders: ['Content-Type', 'email']
}))
const port = 7000

const client = new MongoClient(process.env.BETTER_AUTH_URL_DB);

export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}
const mongoclient = await connectToMongoDB();
const database = mongoclient.db("studiodatabase");
const studiocollection = database.collection("studiocollection");
app.get('/', async (req, res) => {
    res.send({ msg: "allapi" })

})
app.get('/studios', async (req, res) => {
    const data = await studiocollection.find().toArray();
    res.send(data)
})
app.get("/featured", async (req, res) => {
    const data = await studiocollection.find({}).sort({ _id: -1 }).limit(6).toArray();
    res.send(data)
})
app.get('/my-listings', async (req, res) => {
    const userEmail = req.headers.email;
    const data = await studiocollection.find({ email: userEmail }).toArray();
    res.send(data)
})
app.delete('/my-listings/:id', async (req, res) => {
    const { id } = req.params;
    const result = await studiocollection.deleteOne({ _id: new ObjectId(id) })
    res.send(result)
})

app.post('/add-studios', async (req, res) => {
    const data = req.body
    const result = await studiocollection.insertOne(data)
    res.send(result)
})
app.get('/studios/:id', async (req, res) => {
    const { id } = req.params;
    const result = await studiocollection.findOne({ _id: new ObjectId(id) })
    res.send(result)
})


app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})