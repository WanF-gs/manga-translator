package router

import (
	"manga-translator/gateway/internal/config"
	"manga-translator/gateway/internal/handler"
	"manga-translator/gateway/internal/service"

	"github.com/gin-gonic/gin"
)

// SetupRoutes configures all routes for the API Gateway
func SetupRoutes(engine *gin.Engine, discovery *service.Discovery, cfg *config.Config) {
	// Initialize handlers
	proxyHandler := handler.NewProxyHandler(discovery)
	fileUploadHandler := handler.NewFileUploadHandler(cfg)
	healthHandler := handler.NewHealthHandler(cfg)

	// Health check endpoints (no auth required)
	engine.GET("/health", healthHandler.Health())
	engine.GET("/health/ready", healthHandler.Ready())

	// API v1 routes
	v1 := engine.Group("/api/v1")

	// Apply upload size limit to all routes
	v1.Use(fileUploadHandler.UploadMiddleware())

	// Auth routes → user-service
	v1.Any("/auth", proxyHandler.ProxyToService("user-service"))
	v1.Any("/auth/*path", proxyHandler.ProxyToService("user-service"))

	// User routes → user-service
	v1.Any("/user", proxyHandler.ProxyToService("user-service"))
	v1.Any("/user/*path", proxyHandler.ProxyToService("user-service"))

	// Project routes → project-service
	// FIX P0-02: Gin radix-tree conflict — explicit method registration for exact paths
	v1.GET("/projects", proxyHandler.ProxyToService("project-service"))
	v1.POST("/projects", proxyHandler.ProxyToService("project-service"))
	v1.PUT("/projects", proxyHandler.ProxyToService("project-service"))
	v1.DELETE("/projects", proxyHandler.ProxyToService("project-service"))
	v1.Any("/projects/*path", proxyHandler.ProxyToService("project-service"))
	v1.GET("/chapters", proxyHandler.ProxyToService("project-service"))
	v1.POST("/chapters", proxyHandler.ProxyToService("project-service"))
	v1.PUT("/chapters", proxyHandler.ProxyToService("project-service"))
	v1.DELETE("/chapters", proxyHandler.ProxyToService("project-service"))
	v1.Any("/chapters/*path", proxyHandler.ProxyToService("project-service"))
	// FIX: Gin radix-tree conflict — when both "/presets" and "/presets/*path" are registered
	// via Any(), exact-path methods (GET/POST/PUT/DELETE) may not match.
	// Explicitly register all common HTTP methods for the exact path.
	v1.GET("/presets", proxyHandler.ProxyToService("project-service"))
	v1.POST("/presets", proxyHandler.ProxyToService("project-service"))
	v1.PUT("/presets", proxyHandler.ProxyToService("project-service"))
	v1.DELETE("/presets", proxyHandler.ProxyToService("project-service"))
	v1.Any("/presets/*path", proxyHandler.ProxyToService("project-service"))
	v1.GET("/trash", proxyHandler.ProxyToService("project-service"))
	v1.POST("/trash", proxyHandler.ProxyToService("project-service"))
	v1.PUT("/trash", proxyHandler.ProxyToService("project-service"))
	v1.DELETE("/trash", proxyHandler.ProxyToService("project-service"))
	v1.Any("/trash/*path", proxyHandler.ProxyToService("project-service"))

	// Page routes with sub-routing (includes undo/redo, moderation)
	v1.Any("/pages", proxyHandler.AutoProxy())
	v1.Any("/pages/*path", proxyHandler.AutoProxy())

	// Undo/Redo routes → project-service
	v1.Any("/undo", proxyHandler.ProxyToService("project-service"))
	v1.Any("/undo/*path", proxyHandler.ProxyToService("project-service"))

	// Translation routes → translation-service
	v1.Any("/terms", proxyHandler.ProxyToService("translation-service"))
	v1.Any("/terms/*path", proxyHandler.ProxyToService("translation-service"))
	v1.Any("/memory", proxyHandler.ProxyToService("translation-service"))
	v1.Any("/memory/*path", proxyHandler.ProxyToService("translation-service"))

	// Export routes → export-service
	// PRD-compliant /export/* routes (singular)
	v1.Any("/export", proxyHandler.ProxyToService("export-service"))
	v1.Any("/export/*path", proxyHandler.ProxyToService("export-service"))
	// Legacy /exports/* routes (backward compatible)
	v1.Any("/exports", proxyHandler.ProxyToService("export-service"))
	v1.Any("/exports/*path", proxyHandler.ProxyToService("export-service"))
	v1.Any("/export-tasks", proxyHandler.ProxyToService("export-service"))
	v1.Any("/export-tasks/*path", proxyHandler.ProxyToService("export-service"))
	v1.Any("/bilingual", proxyHandler.ProxyToService("export-service"))
	v1.Any("/bilingual/*path", proxyHandler.ProxyToService("export-service"))

	// Reader routes → reader-service
	v1.Any("/reader", proxyHandler.ProxyToService("reader-service"))
	v1.Any("/reader/*path", proxyHandler.ProxyToService("reader-service"))

	// Notification routes → notification-service
	v1.Any("/notifications", proxyHandler.ProxyToService("notification-service"))
	v1.Any("/notifications/*path", proxyHandler.ProxyToService("notification-service"))

	// WebSocket routes — route by sub-path (ws:// upgrade handled by Go's ReverseProxy)
	v1.GET("/ws/notifications", proxyHandler.ProxyToService("notification-service"))
	v1.GET("/ws/projects", proxyHandler.ProxyToService("project-service"))

	// AI Gateway routes → ai-gateway
	v1.Any("/ai", proxyHandler.ProxyToService("ai-gateway"))
	v1.Any("/ai/*path", proxyHandler.ProxyToService("ai-gateway"))

	// ── v3.0 New Routes ──

	// Font management → project-service
	// FIX: Same Gin radix-tree conflict as presets/trash
	v1.GET("/fonts", proxyHandler.ProxyToService("project-service"))
	v1.POST("/fonts", proxyHandler.ProxyToService("project-service"))
	v1.PUT("/fonts", proxyHandler.ProxyToService("project-service"))
	v1.DELETE("/fonts", proxyHandler.ProxyToService("project-service"))
	v1.Any("/fonts/*path", proxyHandler.ProxyToService("project-service"))

	// Character engine → translation-service
	v1.Any("/characters", proxyHandler.ProxyToService("translation-service"))
	v1.Any("/characters/*path", proxyHandler.ProxyToService("translation-service"))

	// Translation quality assessment → translation-service
	v1.Any("/quality", proxyHandler.ProxyToService("translation-service"))
	v1.Any("/quality/*path", proxyHandler.ProxyToService("translation-service"))

	// User feedback → translation-service
	v1.Any("/feedback", proxyHandler.ProxyToService("translation-service"))
	v1.Any("/feedback/*path", proxyHandler.ProxyToService("translation-service"))

	// Team collaboration → project-service
	v1.Any("/collaboration", proxyHandler.ProxyToService("project-service"))
	v1.Any("/collaboration/*path", proxyHandler.ProxyToService("project-service"))

	// API keys → user-service
	v1.Any("/api-keys", proxyHandler.ProxyToService("user-service"))
	v1.Any("/api-keys/*path", proxyHandler.ProxyToService("user-service"))
	// FIX: /api/v1/platform/keys alias → same as /api/v1/api-keys (frontend expects /platform/keys)
	v1.Any("/platform/keys", proxyHandler.ProxyToService("user-service"))
	v1.Any("/platform/keys/*path", proxyHandler.ProxyToService("user-service"))

	// Open platform external API (API-Key auth) → user-service
	v1.Any("/external/*path", proxyHandler.ProxyToService("user-service"))

	// Payments/freemium → user-service
	v1.Any("/payments", proxyHandler.ProxyToService("user-service"))
	v1.Any("/payments/*path", proxyHandler.ProxyToService("user-service"))

	// Cross-work search → reader-service
	v1.Any("/search", proxyHandler.ProxyToService("reader-service"))
	v1.Any("/search/*path", proxyHandler.ProxyToService("reader-service"))

	// Audio theater → export-service
	v1.Any("/audio", proxyHandler.ProxyToService("export-service"))
	v1.Any("/audio/*path", proxyHandler.ProxyToService("export-service"))

	// Dynamic manga → export-service
	v1.Any("/dynamic-manga", proxyHandler.ProxyToService("export-service"))
	v1.Any("/dynamic-manga/*path", proxyHandler.ProxyToService("export-service"))

	// Learning center → reader-service
	v1.Any("/learn", proxyHandler.ProxyToService("reader-service"))
	v1.Any("/learn/*path", proxyHandler.ProxyToService("reader-service"))

	// Review/proofreading → project-service (v3.0 R1)
	// FIX P0-03: Gin radix-tree conflict — explicit method registration
	v1.GET("/review", proxyHandler.ProxyToService("project-service"))
	v1.POST("/review", proxyHandler.ProxyToService("project-service"))
	v1.PUT("/review", proxyHandler.ProxyToService("project-service"))
	v1.DELETE("/review", proxyHandler.ProxyToService("project-service"))
	v1.Any("/review/*path", proxyHandler.ProxyToService("project-service"))

	// Quality assessment dashboard → project-service (v3.0 R2)
	v1.Any("/quality-dashboard", proxyHandler.ProxyToService("project-service"))
	v1.Any("/quality-dashboard/*path", proxyHandler.ProxyToService("project-service"))

	// Erase quality evaluation → image-service
	v1.Any("/erase-quality", proxyHandler.ProxyToService("image-service"))
	v1.Any("/erase-quality/*path", proxyHandler.ProxyToService("image-service"))

	// Content safety moderation → image-service
	v1.Any("/safety", proxyHandler.ProxyToService("image-service"))
	v1.Any("/safety/*path", proxyHandler.ProxyToService("image-service"))

	// ── Storage file serving routes → project-service ──
	// Serves uploaded files (images, archives) stored on project-service disk
	engine.GET("/storage/*filepath", proxyHandler.ProxyToService("project-service"))

	// ── Uploads file serving routes → image-service ──
	// Serves inpainted/rendered images stored on image-service disk (MinIO fallback)
	engine.GET("/uploads/*filepath", proxyHandler.ProxyToService("image-service"))

	// Catch-all for unknown API routes
	engine.NoRoute(func(c *gin.Context) {
		c.JSON(404, gin.H{
			"code":    1002,
			"message": "Route not found",
			"data":    nil,
		})
	})
}
