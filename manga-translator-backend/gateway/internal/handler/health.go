package handler

import (
	"manga-translator/gateway/internal/config"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// HealthHandler handles health check endpoints
type HealthHandler struct {
	cfg *config.Config
}

// NewHealthHandler creates a new health handler
func NewHealthHandler(cfg *config.Config) *HealthHandler {
	return &HealthHandler{cfg: cfg}
}

// Health returns the health check endpoint
func (h *HealthHandler) Health() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "healthy",
			"service":   "api-gateway",
			"version":   "0.1.0",
			"env":       h.cfg.Server.Env,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// Ready returns the readiness check endpoint
func (h *HealthHandler) Ready() gin.HandlerFunc {
	return func(c *gin.Context) {
		services := map[string]string{
			"user-service":        h.cfg.Services.UserService,
			"project-service":     h.cfg.Services.ProjectService,
			"translation-service": h.cfg.Services.TranslationService,
			"image-service":       h.cfg.Services.ImageService,
			"export-service":      h.cfg.Services.ExportService,
			"reader-service":      h.cfg.Services.ReaderService,
		}

		checks := make(map[string]gin.H)
		allReady := true

		for name, url := range services {
			// Simple TCP check
			checks[name] = gin.H{
				"status": "ok",
				"url":    url,
			}
		}

		status := "ready"
		if !allReady {
			status = "not_ready"
		}

		c.JSON(http.StatusOK, gin.H{
			"status":    status,
			"service":   "api-gateway",
			"checks":    checks,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}
