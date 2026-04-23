/** @type {import('next').NextConfig} */
// NOTE: The only API route in this app (/api/generate) is a Route Handler,
// not a Server Action, so experimental.serverActions.bodySizeLimit has no
// effect here. The response payload (base64 PNG) is also outbound, not
// subject to request body limits. Keeping this file minimal on purpose.
const nextConfig = {}

export default nextConfig
