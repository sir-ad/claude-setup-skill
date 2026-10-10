package server

import "example.com/app/internal/store"

type Server struct{ s *store.Store }

func New() *Server { return &Server{s: store.Open()} }

func helper() {}
