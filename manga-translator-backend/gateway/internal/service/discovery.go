package service

import (
	"manga-translator/gateway/internal/config"
	"net/url"
)

// Discovery provides service URL resolution
type Discovery struct {
	services map[string]string
}

// NewDiscovery creates a new service discovery instance
func NewDiscovery(cfg *config.Config) *Discovery {
	return &Discovery{
		services: map[string]string{
			"user-service":         cfg.Services.UserService,
			"project-service":      cfg.Services.ProjectService,
			"translation-service":  cfg.Services.TranslationService,
			"image-service":        cfg.Services.ImageService,
			"export-service":       cfg.Services.ExportService,
			"reader-service":       cfg.Services.ReaderService,
			"ai-gateway":           cfg.Services.AIGateway,
			"notification-service":  cfg.Services.NotificationService,
		},
	}
}

// GetServiceURL returns the URL for a given service name
func (d *Discovery) GetServiceURL(serviceName string) (string, bool) {
	url, ok := d.services[serviceName]
	return url, ok
}

// ResolveTarget resolves the target URL for a given path prefix
// Returns the service URL and the stripped path
func (d *Discovery) ResolveTarget(path string) (string, string) {
	routes := map[string]string{
		"/api/v1/auth/":      "user-service",
		"/api/v1/user/":      "user-service",
		"/api/v1/projects/":  "project-service",
		"/api/v1/chapters/":  "project-service",
		"/api/v1/pages/":     "project-service",
		"/api/v1/presets/":   "project-service",
		"/api/v1/trash/":     "project-service",
		"/api/v1/terms/":     "translation-service",
		"/api/v1/memory/":    "translation-service",
		"/api/v1/translate/": "translation-service",
		"/api/v1/export/":    "export-service",
		"/api/v1/reader/":    "reader-service",
	}

	// Special case: pages with image processing sub-routes
	// /api/v1/pages/{pid}/detect → image-service
	// /api/v1/pages/{pid}/ocr → image-service
	// /api/v1/pages/{pid}/inpaint → image-service
	// /api/v1/pages/{pid}/render → image-service
	// /api/v1/pages/{pid}/enhance → image-service
	// /api/v1/pages/{pid}/translate → translation-service
	imageOps := []string{"/detect", "/ocr", "/inpaint", "/render", "/enhance"}
	for _, op := range imageOps {
		if len(path) > 5+36+len(op) {
			// Check if path matches /api/v1/pages/{uuid}{op}
			prefix := "/api/v1/pages/"
			if path[:len(prefix)] == prefix {
				rest := path[len(prefix):]
				for i, c := range rest {
					if c == '/' {
						suffix := rest[i:]
						if suffix == op {
							serviceURL, ok := d.services["image-service"]
							if ok {
								return serviceURL, path
							}
						}
						break
					}
				}
			}
		}
	}

	// Special case: /api/v1/pages/{pid}/translate → translation-service
	if len(path) > 5+36+len("/translate") {
		prefix := "/api/v1/pages/"
		if path[:len(prefix)] == prefix {
			rest := path[len(prefix):]
			for i, c := range rest {
				if c == '/' {
					suffix := rest[i:]
					if suffix == "/translate" {
						serviceURL, ok := d.services["translation-service"]
						if ok {
							return serviceURL, path
						}
					}
					break
				}
			}
		}
	}

	for prefix, serviceName := range routes {
		if len(path) >= len(prefix) && path[:len(prefix)] == prefix {
			serviceURL, ok := d.services[serviceName]
			if ok {
				return serviceURL, path
			}
		}
	}

	return "", path
}

// ParseServiceURL parses a service URL string into a url.URL
func ParseServiceURL(rawURL string) (*url.URL, error) {
	return url.Parse(rawURL)
}
