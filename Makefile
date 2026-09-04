.PHONY: help install dev build preview test clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (npm ci)
	npm ci

dev: ## Vite dev server on :5173 (proxies /api -> builder-api on :8000)
	npm run dev

build: ## Type-check + production build
	npm run build

preview: ## Serve the production build locally
	npm run preview

test: ## Run tests (vitest)
	npm test

clean: ## Remove build output + deps
	rm -rf dist node_modules
