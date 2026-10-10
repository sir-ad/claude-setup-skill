package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	srv "example.com/app/internal/server"
)

func main() {
	fmt.Println(chi.NewRouter(), srv.New(), http.StatusOK)
}
