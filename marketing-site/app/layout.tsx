import type { Metadata } from "next";
import data from "../data/site.json";
export const metadata: Metadata = {
 metadataBase: new URL(data.urls.site),
 title: "Crystal Ball — The world, in focus.",
 description: data.description,
 openGraph: { description: data.description, images: [{url:"/og.png",width:1200,height:630}] },
 twitter: { card:"summary_large_image", description:data.description, images:["/og.png"] },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
 return <html lang="en"><body>{children}</body></html>;
}
