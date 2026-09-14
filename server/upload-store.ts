import { S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { localObjectStore, r2ObjectStore } from "./object-store.js";

export const uploadStore =
  config.STORAGE_DRIVER === "r2"
    ? r2ObjectStore(
        new S3Client({
          region: "auto",
          endpoint: config.R2_ENDPOINT,
          credentials: {
            accessKeyId: config.R2_ACCESS_KEY_ID,
            secretAccessKey: config.R2_SECRET_ACCESS_KEY,
          },
          forcePathStyle: true,
          maxAttempts: 2,
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        }),
        config.R2_BUCKET,
      )
    : localObjectStore(config.STORAGE_PATH);
