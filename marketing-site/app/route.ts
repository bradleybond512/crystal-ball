import { render } from "../lib/render";
import { respond } from "../lib/response";

export function GET(request: Request) {
  return respond(request, render("/"));
}
