package service

import (
	"fmt"
	"manga-translator/gateway/internal/config"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// AuthService handles JWT token validation
type AuthService struct {
	discovery *Discovery
	cfg       *config.Config
}

// Claims represents the JWT claims
type Claims struct {
	Sub      string `json:"sub"`
	Plan     string `json:"plan"`
	JTI      string `json:"jti"`
	Type     string `json:"type"`
	jwt.RegisteredClaims
}

// NewAuthService creates a new auth service
func NewAuthService(discovery *Discovery, cfg *config.Config) *AuthService {
	return &AuthService{
		discovery: discovery,
		cfg:       cfg,
	}
}

// ValidateToken validates a JWT access token and returns the claims
func (s *AuthService) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(s.cfg.Auth.JWTSecret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	if claims.Type != "access" {
		return nil, fmt.Errorf("not an access token")
	}

	return claims, nil
}

// IsPublicPath checks if a path should skip authentication
func (s *AuthService) IsPublicPath(path string) bool {
	for _, skipPath := range s.cfg.Auth.SkipPaths {
		if strings.HasPrefix(path, skipPath) {
			return true
		}
	}
	return false
}
