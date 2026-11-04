import express from "express";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT);
const frontendOrigin = process.env.FRONTEND_ORIGIN
const authServerUrl = frontendOrigin;
const mongoUrl = process.env.BETTER_AUTH_URL_DB;
const cronSecret = process.env.CRON_SECRET;

if (!mongoUrl) {
    throw new Error("BETTER_AUTH_URL_DB environment variable is required");
}

app.use(express.json());
app.use(
    cors({
        origin: frontendOrigin,
        credentials: true,
        allowedHeaders: ["Content-Type"],
    }),
);

const client = new MongoClient(mongoUrl);
await client.connect();
console.log("You successfully connected to MongoDB!");

const database = client.db("studiodatabase");
const studiocollection = database.collection("studiocollection");
const bookingCollection = database.collection("bookings");

function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value) {
    return typeof value === "string" ? value.trim() : undefined;
}

function readOptionalString(value) {
    return readString(value) || undefined;
}

function serializeBooking({ _id, ...booking }) {
    return { ...booking, id: _id.toString() };
}

function matchesZonedTime(value, bookingDate, bookingTime, timeZone) {
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return false;

        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(date);
        const values = Object.fromEntries(
            parts
                .filter((part) => part.type !== "literal")
                .map(({ type, value: partValue }) => [type, partValue]),
        );

        return (
            `${values.year}-${values.month}-${values.day}` === bookingDate &&
            `${values.hour}:${values.minute}` === bookingTime
        );
    } catch {
        return false;
    }
}

function getBookingOverlapFilter(studioId, bookingDate, startTime, endTime, startAt, endAt) {
    return {
        "studio.id": studioId,
        status: "Confirmed",
        $or: [
            {
                startAt: { $lt: endAt },
                endAt: { $gt: startAt },
            },
            {
                startAt: { $exists: false },
                bookingDate,
                startTime: { $lt: endTime },
                endTime: { $gt: startTime },
            },
        ],
    };
}

async function runBookingMaintenance(now = new Date()) {
    await bookingCollection.updateMany(
        { status: "Confirmed", endAt: { $lte: now } },
        { $set: { status: "Completed", updatedAt: now } },
    );

}

async function getCurrentSession(req) {
    const cookie = req.headers.cookie;
    if (!cookie) return null;

    const response = await fetch(
        new URL("/api/auth/get-session", authServerUrl),
        {
            headers: { cookie },
            cache: "no-store",
        },
    );

    if (!response.ok) {
        throw new Error(`Authentication service returned ${response.status}`);
    }

    const session = await response.json();
    return isObject(session) && isObject(session.user) ? session : null;
}

async function requireSession(req, res) {
    try {
        const session = await getCurrentSession(req);
        if (!session) {
            res.status(401).json({ error: "Authentication required." });
            return null;
        }
        return session;
    } catch (error) {
        console.error("Failed to verify session:", error);
        res.status(503).json({ error: "Unable to verify your session." });
        return null;
    }
}

async function requireStudioSession(req, res, next) {
    const session = await requireSession(req, res);
    if (!session) return;
    req.studioSession = session;
    next();
}

app.get("/", (_req, res) => {
    res.json({ msg: "all api" });
});

app.get("/studios", async (_req, res, next) => {
    try {
        res.json(await studiocollection.find().toArray());
    } catch (error) {
        next(error);
    }
});

app.get("/featured", async (_req, res, next) => {
    try {
        res.json(
            await studiocollection.find({}).sort({ _id: -1 }).limit(6).toArray(),
        );
    } catch (error) {
        next(error);
    }
});

app.get("/my-listings/:email", requireStudioSession, async (req, res, next) => {
    try {
        const userEmail = req.params.email.trim().toLowerCase();
        const sessionEmail = req.studioSession.user.email.trim().toLowerCase();
        if (!userEmail || userEmail !== sessionEmail) {
            return res.status(403).json({ error: "You can only view your own listings." });
        }
        res.json(await studiocollection.find({ email: sessionEmail }).toArray());
    } catch (error) {
        next(error);
    }
});

app.delete("/studios/:id", requireStudioSession, async (req, res, next) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid studio ID." });
        }
        const result = await studiocollection.deleteOne({
            _id: new ObjectId(req.params.id),
            email: req.studioSession.user.email.trim().toLowerCase(),
        });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Studio listing not found." });
        }
        res.json({ deleted: true });
    } catch (error) {
        next(error);
    }
});

app.post(
    "/add-studios",
    requireStudioSession,
    async (req, res, next) => {
        try {
            const title = readString(req.body.title);
            const category = readString(req.body.category);
            const hourlyRate = readString(req.body.hourlyRate);
            const securityDeposit = readString(req.body.securityDeposit);
            const maxCapacity = readString(req.body.maxCapacity);
            const location = readString(req.body.location);
            const overview = readString(req.body.overview);
            const rating = readString(req.body.rating);
            const userEmail = readString(req.studioSession.user.email);
            const hostName = readString(req.studioSession.user.name);
            let amenities;

            try {
                amenities = JSON.parse(req.body.amenities ?? "[]");
            } catch {
                return res.status(400).json({ error: "Amenities must be a valid list." });
            }

            if (
                !title ||
                !category ||
                !hourlyRate ||
                !securityDeposit ||
                !maxCapacity ||
                !location ||
                !overview ||
                !rating ||
                !/^\d+(?:\.\d{1,2})?$/.test(hourlyRate) ||
                !/^\d+(?:\.\d{1,2})?$/.test(securityDeposit) ||
                !/^[1-9]\d*$/.test(maxCapacity) ||
                !/^(?:\d+(?:\.\d{1,2})?)$/.test(rating) ||
                Number(rating) < 0 ||
                Number(rating) > 10 ||
                !userEmail ||
                !hostName ||
                !Array.isArray(amenities) ||
                !amenities.every((amenity) => typeof amenity === "string")
            ) {
                return res.status(400).json({ error: "Please provide valid studio details." });
            }

            const gallery = req.body.imageUrls;
            if (
                !Array.isArray(gallery) ||
                gallery.length === 0 ||
                gallery.length > 8 ||
                gallery.some((imageUrl) => {
                    if (typeof imageUrl !== "string") return true;
                    try {
                        const url = new URL(imageUrl);
                        return url.protocol !== "https:";
                    } catch {
                        return true;
                    }
                })
            ) {
                return res.status(400).json({
                    error: "Enter 1 to 8 valid HTTPS image URLs.",
                });
            }

            const studio = {
                title,
                category,
                hourlyRate,
                securityDeposit,
                maxCapacity,
                location,
                imageUrl: gallery[0],
                gallery,
                overview,
                rating,
                amenities,
                email: userEmail.toLowerCase(),
                hostName,
                createdAt: new Date(),
            };
            const result = await studiocollection.insertOne(studio);

            res.status(201).json({ ...studio, _id: result.insertedId });
        } catch (error) {
            next(error);
        }
    },
);

app.patch("/studios/:id", requireStudioSession, async (req, res, next) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid studio ID." });
        }
        const allowedFields = [
            "title",
            "category",
            "maxCapacity",
            "hourlyRate",
            "securityDeposit",
            "location",
            "rating",
            "overview",
            "amenities",
        ];
        const updates = Object.fromEntries(
            allowedFields
                .filter((field) => Object.hasOwn(req.body, field))
                .map((field) => [field, req.body[field]]),
        );
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "No editable studio details were provided." });
        }
        if (
            Object.hasOwn(updates, "rating") &&
            (!/^(?:\d+(?:\.\d{1,2})?)$/.test(String(updates.rating)) ||
                Number(updates.rating) < 0 ||
                Number(updates.rating) > 10)
        ) {
            return res.status(400).json({ error: "Rating must be between 0 and 10." });
        }
        const result = await studiocollection.updateOne(
            {
                _id: new ObjectId(req.params.id),
                email: req.studioSession.user.email.trim().toLowerCase(),
            },
            { $set: updates },
        );
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Studio listing not found." });
        }
        res.status(200).json({ updated: true });
    } catch (error) {
        next(error);
    }
});
// to do 

app.get("/studios/:id", async (req, res, next) => {
    try {
        if (!ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid studio ID." });
        }
        const studio = await studiocollection.findOne({
            _id: new ObjectId(req.params.id),
        });
        if (!studio) return res.status(404).json({ error: "Studio not found." });
        res.json(studio);
    } catch (error) {
        next(error);
    }
});

app.get("/bookings", async (req, res, next) => {
    const session = await requireSession(req, res);
    if (!session) return;

    try {
        await runBookingMaintenance();
        const { id: userId, email } = session.user;
        const bookings = await bookingCollection
            .find({ $or: [{ userId }, { email }] })
            .sort({ createdAt: -1 })
            .toArray();
        res.json(bookings.map(serializeBooking));
    } catch (error) {
        console.error("Failed to load bookings:", error);
        next(error);
    }
});

app.post("/bookings", requireStudioSession, async (req, res) => {
    const session = req.studioSession;

    const payload = req.body;
    if (!isObject(payload) || !isObject(payload.studio)) {
        return res.status(400).json({ error: "Studio details are required." });
    }

    const studioPayload = payload.studio;
    const studioId =
        readOptionalString(studioPayload._id) ??
        readOptionalString(studioPayload.id);
    const bookingDate = readString(payload.bookingDate);
    const startTime = readString(payload.startTime);
    const endTime = readString(payload.endTime);
    const timeZone = readString(payload.timeZone);
    const startAtValue = readString(payload.startAt);
    const endAtValue = readString(payload.endAt);

    if (
        !studioId ||
        !ObjectId.isValid(studioId) ||
        !bookingDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) ||
        !startTime ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
        !endTime ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
        startTime >= endTime ||
        !timeZone ||
        !startAtValue ||
        !endAtValue ||
        !matchesZonedTime(startAtValue, bookingDate, startTime, timeZone) ||
        !matchesZonedTime(endAtValue, bookingDate, endTime, timeZone)
    ) {
        return res.status(400).json({
            error: "A studio, valid date, time range, and timezone are required.",
        });
    }

    const startAt = new Date(startAtValue);
    const endAt = new Date(endAtValue);
    const now = new Date();
    if (startAt <= now || endAt <= startAt) {
        return res.status(400).json({
            error: "Choose a future booking time with an end time after its start time.",
        });
    }

    try {
        await runBookingMaintenance(now);

        const studioRecord = await studiocollection.findOne({
            _id: new ObjectId(studioId),
        });
        if (!studioRecord) {
            return res.status(404).json({ error: "Studio not found." });
        }

        const transactionSession = client.startSession();
        let booking;
        let bookingId;
        let conflictFound = false;
        try {
            await transactionSession.withTransaction(async () => {
                conflictFound = false;
                booking = undefined;
                bookingId = undefined;

                const lockResult = await studiocollection.updateOne(
                    { _id: new ObjectId(studioId) },
                    { $inc: { bookingRevision: 1 } },
                    { session: transactionSession },
                );
                if (lockResult.matchedCount === 0) return;

                const conflictingBooking = await bookingCollection.findOne(
                    getBookingOverlapFilter(
                        studioId,
                        bookingDate,
                        startTime,
                        endTime,
                        startAt,
                        endAt,
                    ),
                    { session: transactionSession },
                );
                if (conflictingBooking) {
                    conflictFound = true;
                    return;
                }

                booking = {
                    userId: session.user.id,
                    email: session.user.email,
                    fullName: session.user.name,
                    studio: {
                        id: studioId,
                        title: readString(studioRecord.title) ?? "Studio",
                        category: readOptionalString(studioRecord.category),
                        location: readOptionalString(studioRecord.location),
                        imageUrl: readOptionalString(studioRecord.imageUrl),
                        hourlyRate: readOptionalString(studioRecord.hourlyRate),
                    },
                    bookingDate,
                    startTime,
                    endTime,
                    timeZone,
                    startAt,
                    endAt,
                    notes: readOptionalString(payload.notes) ?? "",
                    status: "Pending",
                    createdAt: now,
                    updatedAt: now,
                };
                const result = await bookingCollection.insertOne(booking, {
                    session: transactionSession,
                });
                bookingId = result.insertedId;
            });
        } finally {
            await transactionSession.endSession();
        }

        if (conflictFound) {
            return res.status(409).json({
                error: "This studio is already booked for the selected time. Choose another time.",
            });
        }
        if (!booking || !bookingId) {
            return res.status(404).json({ error: "Studio not found." });
        }

        res.status(201).json({
            ...booking,
            id: bookingId.toString(),
        });
    } catch (error) {
        console.error("Failed to create booking:", error);
        res.status(500).json({ error: "Unable to create booking." });
    }
});

app.post("/bookings/:id/confirm", async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;

    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(404).json({ error: "Booking not found." });
    }

    try {
        const ownershipFilter = {
            _id: new ObjectId(id),
            $or: [
                { userId: session.user.id },
                { email: session.user.email },
            ],
        };
        const existingBooking = await bookingCollection.findOne(ownershipFilter);
        if (!existingBooking) {
            return res.status(404).json({ error: "Booking not found." });
        }
        if (existingBooking.status !== "Pending") {
            return res.status(409).json({
                error: "Only pending bookings can be confirmed.",
            });
        }

        const studioObjectId = ObjectId.isValid(existingBooking.studio?.id)
            ? new ObjectId(existingBooking.studio.id)
            : null;
        if (!studioObjectId) {
            return res.status(400).json({ error: "This booking has an invalid studio." });
        }
        if (
            !(existingBooking.startAt instanceof Date) ||
            !(existingBooking.endAt instanceof Date) ||
            existingBooking.startAt <= new Date()
        ) {
            return res.status(409).json({
                error: "This booking time has already started and cannot be confirmed.",
            });
        }

        const transactionSession = client.startSession();
        let conflictFound = false;
        let confirmed = false;
        try {
            await transactionSession.withTransaction(async () => {
                const lockResult = await studiocollection.updateOne(
                    { _id: studioObjectId },
                    { $inc: { bookingRevision: 1 } },
                    { session: transactionSession },
                );
                if (lockResult.matchedCount === 0) return;

                const booking = await bookingCollection.findOne(
                    { ...ownershipFilter, status: "Pending" },
                    { session: transactionSession },
                );
                if (!booking) return;
                if (!(booking.startAt instanceof Date) || booking.startAt <= new Date()) {
                    return;
                }

                const conflict = await bookingCollection.findOne(
                    getBookingOverlapFilter(
                        booking.studio.id,
                        booking.bookingDate,
                        booking.startTime,
                        booking.endTime,
                        booking.startAt,
                        booking.endAt,
                    ),
                    { session: transactionSession },
                );
                if (conflict) {
                    conflictFound = true;
                    return;
                }

                const result = await bookingCollection.updateOne(
                    { _id: booking._id, status: "Pending" },
                    { $set: { status: "Confirmed", updatedAt: new Date() } },
                    { session: transactionSession },
                );
                confirmed = result.modifiedCount === 1;
            });
        } finally {
            await transactionSession.endSession();
        }

        if (conflictFound) {
            return res.status(409).json({
                error: "This studio is already booked for this time. The booking remains pending.",
            });
        }
        if (!confirmed) {
            return res.status(409).json({
                error: "This booking could not be confirmed. Refresh your bookings and try again.",
            });
        }

        res.json({ id, status: "Confirmed" });
    } catch (error) {
        console.error("Failed to confirm booking:", error);
        res.status(500).json({ error: "Unable to confirm booking." });
    }
});

app.get("/cron/bookings", async (req, res) => {
    if (!cronSecret) {
        return res.status(503).json({ error: "Booking cron is not configured." });
    }
    if (req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized." });
    }

    try {
        await runBookingMaintenance();
        res.json({ ok: true });
    } catch (error) {
        console.error("Failed to update booking statuses:", error);
        res.status(500).json({ error: "Unable to update booking statuses." });
    }
});

app.patch("/bookings/:id", async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;

    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
        return res.status(404).json({ error: "Booking not found." });
    }

    try {
        const result = await bookingCollection.updateOne(
            {
                _id: new ObjectId(id),
                $or: [
                    { userId: session.user.id },
                    { email: session.user.email },
                ],
                status: { $regex: /^pending$/i },
            },
            { $set: { status: "Cancelled", updatedAt: new Date() } },
        );

        if (result.matchedCount === 0) {
            return res.status(409).json({
                error: "This booking can no longer be cancelled.",
            });
        }

        res.json({ id, status: "Cancelled" });
    } catch (error) {
        console.error("Failed to cancel booking:", error);
        res.status(500).json({ error: "Unable to cancel booking." });
    }
});

app.use((error, _req, res, _next) => {
    console.error("API request failed:", error);
    res.status(500).json({ error: "Unable to complete the request." });
});

app.listen(port, () => {
    console.log(`Studio API listening on port ${port}`);
});
