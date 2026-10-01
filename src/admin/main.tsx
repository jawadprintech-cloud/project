import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp";
import "../styles.css";
import "./admin.css";

createRoot(document.getElementById("root")!).render(<AdminApp />);
