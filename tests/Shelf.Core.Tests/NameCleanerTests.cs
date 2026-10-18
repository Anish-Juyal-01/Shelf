using Shelf.Core.Naming;

namespace Shelf.Core.Tests;

public class NameCleanerTests
{
    [Theory]
    [InlineData("Hollow_Knight_v1.5.78 [FitGirl Repack]", "Hollow Knight")]
    [InlineData("F1 22 Champions Edition MULTi11 - ElAmigos version 1.05", "F1 22 Champions Edition")]
    [InlineData("Sekiro Shadows Die Twice GOTY Edition", "Sekiro Shadows Die Twice GOTY Edition")]
    [InlineData("Cyberpunk.2077.v2.1-GOG", "Cyberpunk 2077")]
    [InlineData("Baldurs.Gate.3.Build.12345-TENOKE", "Baldurs Gate 3")]
    [InlineData("Red Dead Redemption 2 [DODI Repack]", "Red Dead Redemption 2")]
    [InlineData("The Witcher 3 Wild Hunt - Complete Edition v4.04", "The Witcher 3 Wild Hunt - Complete Edition")]
    [InlineData("Terraria v1.4.4.9", "Terraria")]
    [InlineData("Disco Elysium The Final Cut (GOG)", "Disco Elysium The Final Cut")]
    [InlineData("Celeste (2018)", "Celeste")]
    [InlineData("HollowKnight.exe", "Hollow Knight")]
    [InlineData("Stray-Win64-Shipping.exe", "Stray")]
    [InlineData("Cyberpunk2077.exe", "Cyberpunk 2077")]
    [InlineData("DOOMEternal", "DOOM Eternal")]
    [InlineData("hades", "Hades")]
    [InlineData("SEKIRO", "Sekiro")]
    [InlineData("GTA V", "GTA V")]
    [InlineData("STAR WARS JEDI FALLEN ORDER", "Star Wars Jedi Fallen Order")]
    [InlineData("dark_souls_iii", "Dark Souls III")]
    [InlineData("Lies of P Deluxe Edition (v1.2.0.0 + DLC) [FitGirl Repack]", "Lies of P Deluxe Edition")]
    [InlineData("Elden Ring - Update 1.10", "Elden Ring")]
    [InlineData("Hogwarts.Legacy.Deluxe.Edition-EMPRESS", "Hogwarts Legacy Deluxe Edition")]
    [InlineData("Portal 2", "Portal 2")]
    [InlineData("F1 22", "F1 22")]
    [InlineData("Half-Life", "Half-Life")]
    [InlineData("Plants vs. Zombies GOTY", "Plants vs. Zombies GOTY")]
    [InlineData("DaVinci_Resolve_21.1.1_Windows", "DaVinci Resolve Windows")]
    public void Cleans(string raw, string expected) => Assert.Equal(expected, NameCleaner.Clean(raw));

    [Fact]
    public void NeverReturnsEmptyForNonEmptyInput()
    {
        Assert.Equal("[FitGirl Repack]", NameCleaner.Clean("[FitGirl Repack]"));
        Assert.Equal("", NameCleaner.Clean("   "));
    }

    [Theory]
    [InlineData("Sekiro™: Shadows Die Twice - GOTY Edition", "Sekiro Shadows Die Twice GOTY Edition")]
    [InlineData("The Witcher 3", "Witcher 3")]
    [InlineData("Ori & the Blind Forest", "Ori and the Blind Forest")]
    [InlineData("Pokémon", "Pokemon")]
    public void KeysMatchAcrossSpellings(string a, string b) => Assert.Equal(NameCleaner.Key(a), NameCleaner.Key(b));
}
