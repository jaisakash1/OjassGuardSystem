import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ limit: "20kb", extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

import healthcheckRouter from "./routes/healthcheck.routes.js";
import userRouter from "./routes/user.routes.js";
import guardRouter from "./routes/guard.routes.js";
import adminRouter from "./routes/admin.routes.js";
import locationRouter from "./routes/location.routes.js";
import livelocrouter from "./routes/liveloc.routes.js";
app.use("/api/v1/healthcheck", healthcheckRouter);
app.use("/api/v1/user", userRouter);
app.use("/api/v1/guard", guardRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/location", locationRouter);
app.use("/api/v1/liveloc", livelocrouter);
export { app };
