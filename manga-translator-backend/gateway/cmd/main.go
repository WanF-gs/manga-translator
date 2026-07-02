package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"manga-translator/gateway/internal/config"
	"manga-translator/gateway/internal/middleware"
	"manga-translator/gateway/internal/router"
	"manga-translator/gateway/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Set Gin mode
	gin.SetMode(cfg.Server.Mode)

	// Create Gin engine
	engine := gin.New()

	// Disable trailing slash redirect — prevents CORS preflight redirect issues
	// when frontend calls /api/v1/projects?query (no trailing slash)
	engine.RedirectTrailingSlash = false

	// Initialize service discovery
	discovery := service.NewDiscovery(cfg)

	// Initialize auth service
	authService := service.NewAuthService(discovery, cfg)

	// Prometheus /metrics endpoint (no auth required)
	engine.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// Setup middleware chain (order matters)
	engine.Use(middleware.Recovery())
	engine.Use(middleware.Logger())
	engine.Use(middleware.CORS(cfg.CORS))
	engine.Use(middleware.RateLimiter(cfg.RateLimit))
	engine.Use(middleware.AuthMiddleware(authService, cfg))

	// Setup routes
	router.SetupRoutes(engine, discovery, cfg)

	// Create HTTP server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Server.Port),
		Handler:      engine,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	// Start server
	go func() {
		log.Printf("[GATEWAY] Starting API Gateway on port %s (env: %s)", cfg.Server.Port, cfg.Server.Env)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[GATEWAY] Failed to start: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[GATEWAY] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("[GATEWAY] Forced shutdown: %v", err)
	}

	log.Println("[GATEWAY] Server exited")
}
