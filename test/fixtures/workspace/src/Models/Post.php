<?php

namespace App\Models;

use App\Traits\HasFactory;

class Post extends BaseModel
{
    use HasFactory;

    public string $title;
    public ?User $author;

    public function __construct(string $title, ?User $author = null)
    {
        $this->title = $title;
        $this->author = $author;
    }

    public function getAuthor(): ?User
    {
        return $this->author;
    }
}
