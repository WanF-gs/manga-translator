package middleware

import (
	"manga-translator/gateway/internal/config"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimiter returns a rate limiting middleware
func RateLimiter(cfg config.RateLimitConfig) gin.HandlerFunc {
	if !cfg.Enabled {
		return func(c *gin.Context) {
			c.Next()
		}
	}

	var mu sync.Mutex
	userVisitors := make(map[string]*visitor)
	ipVisitors := make(map[string]*visitor)

	// Background cleanup goroutine
	go func() {
		for {
			time.Sleep(cfg.CleanupInterval)
			mu.Lock()
			for key, v := range userVisitors {
				if time.Since(v.lastSeen) > cfg.CleanupInterval {
					delete(userVisitors, key)
				}
			}
			for key, v := range ipVisitors {
				if time.Since(v.lastSeen) > cfg.CleanupInterval {
					delete(ipVisitors, key)
				}
			}
			mu.Unlock()
		}
	}()

	return func(c *gin.Context) {
		// Skip rate limiting for WebSocket connections (long-lived, not HTTP requests)
		if strings.ToLower(c.GetHeader("Upgrade")) == "websocket" {
			c.Next()
			return
		}

		// Skip rate limiting for image/storage serving (static file-like requests)
		path := c.Request.URL.Path
		if c.Request.Method == "GET" && (strings.Contains(path, "/pages/") && strings.Contains(path, "/image") || strings.HasPrefix(path, "/storage/") || strings.HasPrefix(path, "/uploads/")) {
			c.Next()
			return
		}

		// IP-based rate limiting
		ip := c.ClientIP()
		mu.Lock()
		v, exists := ipVisitors[ip]
		if !exists {
			ipVisitors[ip] = &visitor{
				limiter:  rate.NewLimiter(rate.Limit(cfg.IPRateLimit), cfg.IPBurst),
				lastSeen: time.Now(),
			}
			v = ipVisitors[ip]
		}
		v.lastSeen = time.Now()
		mu.Unlock()

		if !v.limiter.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"code":    1008,
				"message": "Rate limit exceeded, please try again later",
				"data":    nil,
			})
			return
		}

		// User-based rate limiting (if user is authenticated)
		if userID, exists := c.Get("user_id"); exists {
			userKey := userID.(string)
			mu.Lock()
			uv, exists := userVisitors[userKey]
			if !exists {
				userVisitors[userKey] = &visitor{
					limiter:  rate.NewLimiter(rate.Limit(cfg.UserRateLimit), cfg.UserBurst),
					lastSeen: time.Now(),
				}
				uv = userVisitors[userKey]
			}
			uv.lastSeen = time.Now()
			mu.Unlock()

			if !uv.limiter.Allow() {
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
					"code":    1008,
					"message": "User rate limit exceeded",
					"data":    nil,
				})
				return
			}
		}

		c.Next()
	}
}
