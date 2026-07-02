package middleware

import (
	"manga-translator/gateway/internal/config"
	"net/http"

	"github.com/gin-gonic/gin"
)

// CORS returns a CORS middleware handler
func CORS(cfg config.CORSConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// Skip CORS check for WebSocket upgrade requests (handled separately)
		if c.GetHeader("Upgrade") == "websocket" {
			c.Next()
			return
		}

		// Check if origin is allowed
		allowed := false
		for _, allowedOrigin := range cfg.AllowedOrigins {
			if allowedOrigin == "*" || allowedOrigin == origin {
				allowed = true
				break
			}
		}

		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		} else if len(cfg.AllowedOrigins) > 0 && cfg.AllowedOrigins[0] == "*" {
			c.Header("Access-Control-Allow-Origin", "*")
		}

		c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin,Content-Type,Accept,Authorization,X-Request-ID,Idempotency-Key,X-Device-Type,Accept-Version")
		c.Header("Access-Control-Expose-Headers", "X-Request-ID,X-RateLimit-Remaining,X-RateLimit-Reset,Content-Disposition")
		c.Header("Access-Control-Max-Age", "86400")
		c.Header("Access-Control-Allow-Credentials", "true")

		// Handle preflight requests — abort immediately to avoid triggering route handlers
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
