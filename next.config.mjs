/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app runs entirely in the browser (Supabase is called client-side), so it's
  // exported as static files for Netlify. `npm run build` writes them to ./out.
  output: 'export',
  allowedDevOrigins: ['192.168.178.202'],
  devIndicators: {
    position: 'top-left',
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
