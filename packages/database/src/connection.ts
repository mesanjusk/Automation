import mongoose from "mongoose";

// Works both in Next.js (hot-reloadable serverless-ish routes) and the
// long-running worker process by caching the connection promise on the
// global object, so repeated imports never open duplicate connections.
declare global {
  // eslint-disable-next-line no-var
  var __bosMongooseConn: Promise<typeof mongoose> | undefined;
}

export async function connectToDatabase(uri = process.env.MONGODB_URI): Promise<typeof mongoose> {
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  if (!global.__bosMongooseConn) {
    mongoose.set("strictQuery", true);
    global.__bosMongooseConn = mongoose.connect(uri, {
      maxPoolSize: 10,
    });
  }
  return global.__bosMongooseConn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  global.__bosMongooseConn = undefined;
}

export { mongoose };
