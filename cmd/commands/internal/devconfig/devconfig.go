package devconfig

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/inngest/inngest/pkg/logger"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func InitConfig(ctx context.Context, cmd *cobra.Command) error {
	if err := mapFlags(cmd); err != nil {
		return err
	}

	loadConfigFile(ctx, cmd)

	return nil
}

func loadConfigFile(ctx context.Context, cmd *cobra.Command) {
	l := logger.From(ctx).With().Logger()

	configPath, _ := cmd.Flags().GetString("config")
	if configPath != "" {
		// User specified the config file so we'll use that
		viper.SetConfigFile(configPath)
	} else {
		// Don't need to specify the extension since Viper will try to load
		// various extensions (inngest.json, inngest.yaml, etc.)
		viper.SetConfigName("inngest")

		if cwd, err := os.Getwd(); err != nil {
			l.Warn().Err(err).Msg("error getting current directory")
		} else {
			// Walk up the directory tree looking for a config file
			for dir := cwd; dir != "/"; dir = filepath.Dir(dir) {
				viper.AddConfigPath(dir)
			}
		}

		if homeDir, err := os.UserHomeDir(); err != nil {
			l.Warn().Err(err).Msg("error getting home directory")
		} else {
			// Fallback to ~/.config/inngest
			viper.AddConfigPath(filepath.Join(homeDir, ".config/inngest"))
		}
	}

	if err := viper.ReadInConfig(); err != nil {
		if configPath != "" {
			// User explicitly specified a config file but we couldn't read it
			log.Fatalf("Error reading config file: %v", err)
		}
	} else {
		l.Info().Msg(fmt.Sprintf("Using config %s", viper.ConfigFileUsed()))
	}
}

// mapFlags binds the command line flags to the viper configuration
func mapFlags(cmd *cobra.Command) error {
	var err error
	err = errors.Join(err, viper.BindPFlag("host", cmd.Flags().Lookup("host")))
	err = errors.Join(err, viper.BindPFlag("no-discovery", cmd.Flags().Lookup("no-discovery")))
	err = errors.Join(err, viper.BindPFlag("no-poll", cmd.Flags().Lookup("no-poll")))
	err = errors.Join(err, viper.BindPFlag("poll-interval", cmd.Flags().Lookup("poll-interval")))
	err = errors.Join(err, viper.BindPFlag("port", cmd.Flags().Lookup("port")))
	err = errors.Join(err, viper.BindPFlag("retry-interval", cmd.Flags().Lookup("retry-interval")))
	err = errors.Join(err, viper.BindPFlag("tick", cmd.Flags().Lookup("tick")))
	err = errors.Join(err, viper.BindPFlag("urls", cmd.Flags().Lookup("sdk-url")))

	return err
}
