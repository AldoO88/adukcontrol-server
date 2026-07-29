// Servicio de Almacenamiento en S3 (para buffers de upload fallidos)
// Wrapper sobre AWS SDK v2 para subir/descargar/borrar/listar objetos.
//
// Si las variables de entorno AWS_* están configuradas y
// PENDING_UPLOADS_BACKEND=s3, el sistema persiste los buffers pendientes
// en S3 en vez de en disco. Esto permite:
//   - Deploys multi-container o serverless
//   - Persistencia entre reinicios
//   - Cleanup centralizado
//
// Variables de entorno requeridas:
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION (e.g., "us-east-1")
//   S3_PENDING_UPLOADS_BUCKET (e.g., "eduk-pending-uploads")
//   PENDING_UPLOADS_BACKEND=s3  (para activar)

const AWS = require("aws-sdk");

let s3Instance = null;
const getS3 = () => {
  if (s3Instance) return s3Instance;
  s3Instance = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || "us-east-1",
  });
  return s3Instance;
};

const BUCKET = () => process.env.S3_PENDING_UPLOADS_BUCKET;
const S3_PREFIX = "pending-uploads/";

// Sube un buffer a S3. Devuelve la key (path dentro del bucket).
const putBuffer = async (key, buffer) => {
  const params = {
    Bucket: BUCKET(),
    Key: `${S3_PREFIX}${key}`,
    Body: buffer,
    // Server-side encryption: AES256. Los buffers son temporales pero
    // pueden contener datos sensibles (fotos de menores).
    ServerSideEncryption: "AES256",
    // Metadata para debug
    Metadata: {
      uploadedAt: new Date().toISOString(),
    },
  };
  await getS3().putObject(params).promise();
  return `${S3_PREFIX}${key}`;
};

// Descarga un objeto a buffer.
const getBuffer = async (key) => {
  const params = {
    Bucket: BUCKET(),
    Key: key.startsWith(S3_PREFIX) ? key : `${S3_PREFIX}${key}`,
  };
  const result = await getS3().getObject(params).promise();
  return result.Body;
};

// Borra un objeto.
const deleteObject = async (key) => {
  const params = {
    Bucket: BUCKET(),
    Key: key.startsWith(S3_PREFIX) ? key : `${S3_PREFIX}${key}`,
  };
  await getS3().deleteObject(params).promise();
};

// Lista todos los objetos (pagina internamente).
const listAll = async () => {
  const objects = [];
  let continuationToken = null;
  do {
    const params = {
      Bucket: BUCKET(),
      Prefix: S3_PREFIX,
    };
    if (continuationToken) params.ContinuationToken = continuationToken;
    const result = await getS3().listObjectsV2(params).promise();
    objects.push(...(result.Contents || []));
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);
  return objects;
};

// Indica si el backend S3 está habilitado.
const isEnabled = () => process.env.PENDING_UPLOADS_BACKEND === "s3";

module.exports = {
  putBuffer,
  getBuffer,
  deleteObject,
  listAll,
  isEnabled,
  S3_PREFIX,
};
