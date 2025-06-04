# Deployment Instructions

When deploying the frontend, you need to set the `VITE_API_BASE_URL` environment variable to the absolute URL of your backend API.

For example, if your backend API is accessible at `https://api.example.com`, you should set the `VITE_API_BASE_URL` environment variable to `https://api.example.com` when building the frontend.

How you set the environment variable depends on your deployment platform:

*   **Docker:** If you're using Docker, you can set the environment variable in your `Dockerfile` or during the `docker run` command.
*   **Netlify/Vercel/etc.:** If you're using a platform like Netlify or Vercel, you can usually set environment variables in the project settings.
*   **Other platforms:** Consult the documentation for your specific deployment platform to learn how to set environment variables.
