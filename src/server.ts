import cluster from "cluster";
import os from "os";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

class Server {
  private app: express.Express;

  constructor() {
    this.app = express();
    this.app.use(cors());
    this.app.use(helmet());
    this.app.use(morgan("dev"));
    this.app.use(express.json());
  }

  public listen(port: number) {
    this.app.listen(port, () => {
      process.env.NODE_ENV === "production"
        ? console.log(`Worker ${process.pid} is listening on port ${port}`)
        : console.log(`Server is running on port ${port}`);
    });
  }
}

if (process.env.NODE_ENV === "production") {
  if (cluster.isPrimary) {
    const numCPUs = os.cpus().length / 8;
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on("fork", (worker) => {
      console.log(`Worker ${worker.id} has been forked`);
    });

    cluster.on("exit", (worker) => {
      console.log(`Worker ${worker.id} has exited`);
    });
  } else if (cluster.worker) {
    const app = new Server();
    app.listen(
      process.env.NODE_ENV === "production"
        ? parseInt(process.env.PORT || "3000", 10)
        : 3000,
    );
  }
}

const app = new Server();
app.listen(
  process.env.NODE_ENV === "production"
    ? parseInt(process.env.PORT || "3000", 10)
    : 3000,
);
