package middleware

import (
	"log"
	"manga-translator/gateway/internal/config"
	"manga-translator/gateway/internal/service"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware validates JWT tokens for protected routes
func AuthMiddleware(authService *service.AuthService, cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip auth for OPTIONS preflight (CORS is handled by CORS middleware)
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}

		// Skip auth for WebSocket upgrade requests (token is passed via query param)
		if strings.ToLower(c.GetHeader("Upgrade")) == "websocket" {
			c.Next()
			return
		}

		// Skip auth for public paths
		if authService.IsPublicPath(c.Request.URL.Path) {
			c.Next()
			return
		}

		// Skip auth for page image serving endpoints (used by <img> tags without auth headers)
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/v1/pages/") && strings.HasSuffix(path, "/image") {
			c.Next()
			return
		}
	// Skip auth for static file paths (storage / uploads / font files)
	if strings.HasPrefix(path, "/storage/") || strings.HasPrefix(path, "/uploads/") || strings.HasPrefix(path, "/api/v1/fonts/file/") {
		c.Next()
		return
	}

		// Skip if auth is disabled
		if !cfg.Auth.Enabled {
			c.Next()
			return
		}

		// Extract token from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			log.Printf("[AUTH] Missing token for %s %s (Cookie count: %d)", c.Request.Method, path, len(c.Request.Cookies()))
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    2001,
				"message": "Missing authorization header",
				"data":    nil,
			})
			return
		}

		// Check Bearer prefix
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    2001,
				"message": "Invalid authorization header format",
				"data":    nil,
			})
			return
		}

		tokenString := parts[1]

		// Validate token
		claims, err := authService.ValidateToken(tokenString)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    2003,
				"message": "Invalid or expired token",
				"data":    nil,
			})
			return
		}

		// Set user info in context for downstream use
		c.Set("user_id", claims.Sub)
		c.Set("plan_type", claims.Plan)
		c.Set("token_jti", claims.JTI)

		c.Next()
	}
}
