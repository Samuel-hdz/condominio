import mongoose from "mongoose";
import dotenv from "dotenv";
import EnhancedSeeder from "./src/libs/enhancedSeeder.js";

dotenv.config();

export const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/condominio");
        console.log("MongoDB se ha conectado");
        
        // Usar seeder
        await EnhancedSeeder.seedAll();
    } catch (error) {
        console.error("MongoDB error en la conexión:", error);
        process.exit(1);
    }
};

