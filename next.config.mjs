/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.178.202', '10.195.1.32'],
  devIndicators: {
    position: 'top-left',
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
