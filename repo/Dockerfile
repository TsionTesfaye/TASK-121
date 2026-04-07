FROM node:18-alpine

WORKDIR /app

# Install dependencies using the lockfile for reproducibility.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source after dependency install to maximise layer caching.
COPY . .

# Default command runs the full test suite.
# Override with 'npm run dev' for the development server.
CMD ["npm", "run", "test"]
