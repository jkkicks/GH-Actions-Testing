import type { LoaderFunction } from "@remix-run/node";

export const loader: LoaderFunction = () => {
  return new Response("OK", { status: 200 });
};
