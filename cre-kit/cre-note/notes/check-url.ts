import { z } from "zod";

for (const value of [
  "http://localhost:8787",
  "http://127.0.0.1:8787/",
  "https://example.com"
]) {
  console.log(value, z.string().url().safeParse(value));
}
