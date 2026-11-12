require 'json'
require 'thor'
require_relative 'acme/engine'

module Acme
  VERSION = '1.0'
  Engine.run
end
